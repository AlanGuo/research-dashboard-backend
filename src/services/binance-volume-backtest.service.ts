import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { VolumeBacktest, VolumeBacktestDocument, HourlyVolumeRankingItem } from '../models/volume-backtest.model';
import { VolumeBacktestParamsDto, VolumeBacktestResponse } from '../dto/volume-backtest-params.dto';

interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  count: number;
  takerBuyVolume: string;
  takerBuyQuoteVolume: string;
}

interface VolumeWindow {
  symbol: string;
  data: KlineData[]; // 24小时的K线数据窗口
  volume24h: number;
  quoteVolume24h: number;
}

@Injectable()
export class BinanceVolumeBacktestService {
  private readonly logger = new Logger(BinanceVolumeBacktestService.name);
  private readonly binanceApiUrl = 'https://api.binance.com';
  private readonly requestDelay = 100; // API请求间隔(ms)

  constructor(
    @InjectModel(VolumeBacktest.name)
    private volumeBacktestModel: Model<VolumeBacktestDocument>,
  ) {}

  /**
   * 执行成交量排行榜回测
   */
  async executeVolumeBacktest(params: VolumeBacktestParamsDto): Promise<VolumeBacktestResponse> {
    const startTime = new Date(params.startTime);
    const endTime = new Date(params.endTime);
    const startExecution = Date.now();

    this.logger.log(`开始执行成交量回测: ${startTime.toISOString()} - ${endTime.toISOString()}`);

    try {
      // 1. 获取活跃交易对列表
      const activeSymbols = await this.getActiveSymbols(params);
      this.logger.log(`获取到 ${activeSymbols.length} 个活跃交易对`);

      // 2. 计算需要处理的小时数
      const totalHours = Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60));
      this.logger.log(`需要处理 ${totalHours} 个小时的数据`);

      // 3. 执行回测计算
      const results = await this.calculateHourlyRankings(activeSymbols, startTime, endTime, params);

      // 4. 保存结果到数据库
      await this.saveBacktestResults(results);

      const processingTime = Date.now() - startExecution;
      this.logger.log(`回测完成，耗时: ${processingTime}ms`);

      return {
        success: true,
        data: results.map(result => ({
          timestamp: result.timestamp.toISOString(),
          hour: result.hour,
          rankings: result.rankings,
          marketStats: {
            totalVolume: result.totalMarketVolume,
            totalQuoteVolume: result.totalMarketQuoteVolume,
            activePairs: result.activePairs,
            topMarketConcentration: this.calculateMarketConcentration(result.rankings),
          },
          calculationTime: result.calculationDuration,
        })),
        meta: {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          totalHours,
          dataPoints: results.length,
          processingTime,
        },
      };
    } catch (error) {
      this.logger.error('回测执行失败:', error);
      throw error;
    }
  }

  /**
   * 获取活跃交易对列表
   */
  private async getActiveSymbols(params: VolumeBacktestParamsDto): Promise<string[]> {
    try {
      const response = await axios.get(`${this.binanceApiUrl}/api/v3/exchangeInfo`);
      const symbols = response.data.symbols
        .filter(symbol => 
          symbol.status === 'TRADING' &&
          symbol.quoteAsset === (params.quoteAsset || 'USDT') &&
          !symbol.symbol.includes('UP') &&
          !symbol.symbol.includes('DOWN') &&
          !symbol.symbol.includes('BULL') &&
          !symbol.symbol.includes('BEAR')
        )
        .map(symbol => symbol.symbol);

      // 如果指定了特定交易对，则使用指定的
      if (params.symbols && params.symbols.length > 0) {
        return params.symbols.filter(symbol => symbols.includes(symbol));
      }

      return symbols;
    } catch (error) {
      this.logger.error('获取交易对信息失败:', error);
      throw error;
    }
  }

  /**
   * 计算每小时的成交量排行榜
   */
  private async calculateHourlyRankings(
    symbols: string[],
    startTime: Date,
    endTime: Date,
    params: VolumeBacktestParamsDto
  ): Promise<VolumeBacktest[]> {
    const results: VolumeBacktest[] = [];
    const volumeWindows = new Map<string, VolumeWindow>();

    // 初始化滑动窗口
    for (const symbol of symbols) {
      volumeWindows.set(symbol, {
        symbol,
        data: [],
        volume24h: 0,
        quoteVolume24h: 0,
      });
    }

    // 预加载前24小时的数据作为初始窗口
    const preLoadStart = new Date(startTime.getTime() - 24 * 60 * 60 * 1000);
    await this.preloadVolumeWindows(volumeWindows, preLoadStart, startTime);

    // 按小时处理数据
    const currentTime = new Date(startTime);
    while (currentTime < endTime) {
      const hourStart = Date.now();
      this.logger.log(`处理时间点: ${currentTime.toISOString()}`);

      // 更新滑动窗口
      await this.updateVolumeWindows(volumeWindows, currentTime);

      // 计算排行榜
      const rankings = this.calculateRankings(volumeWindows, params.limit || 50, params.minVolumeThreshold || 10000);

      // 计算市场统计
      const marketStats = this.calculateMarketStats(rankings);

      results.push({
        timestamp: new Date(currentTime),
        hour: currentTime.getHours(),
        rankings,
        totalMarketVolume: marketStats.totalVolume,
        totalMarketQuoteVolume: marketStats.totalQuoteVolume,
        activePairs: marketStats.activePairs,
        createdAt: new Date(),
        calculationDuration: Date.now() - hourStart,
      });

      // 移动到下一小时
      currentTime.setHours(currentTime.getHours() + 1);
    }

    return results;
  }

  /**
   * 预加载初始24小时数据窗口
   */
  private async preloadVolumeWindows(
    volumeWindows: Map<string, VolumeWindow>,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    this.logger.log('预加载初始数据窗口...');
    
    const batchSize = 10; // 批量处理数量
    const symbols = Array.from(volumeWindows.keys());
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const promises = batch.map(symbol => this.loadSymbolKlines(symbol, startTime, endTime));
      
      try {
        const results = await Promise.all(promises);
        results.forEach((klines, index) => {
          const symbol = batch[index];
          const window = volumeWindows.get(symbol);
          if (window && klines) {
            window.data = klines;
            this.updateWindowVolume(window);
          }
        });
      } catch (error) {
        this.logger.warn(`批量加载数据失败:`, error);
      }

      // API限流控制
      await this.delay(this.requestDelay * batchSize);
    }
  }

  /**
   * 更新滑动窗口数据
   */
  private async updateVolumeWindows(
    volumeWindows: Map<string, VolumeWindow>,
    currentTime: Date
  ): Promise<void> {
    const hourStart = currentTime.getTime();
    const hourEnd = hourStart + 60 * 60 * 1000;
    const window24hStart = hourStart - 24 * 60 * 60 * 1000;

    for (const [symbol, window] of volumeWindows) {
      try {
        // 获取当前小时的K线数据
        const newKlines = await this.loadSymbolKlines(
          symbol,
          new Date(hourStart),
          new Date(hourEnd)
        );

        if (newKlines && newKlines.length > 0) {
          // 添加新数据
          window.data.push(...newKlines);

          // 移除超过24小时的旧数据
          window.data = window.data.filter(kline => kline.openTime >= window24hStart);

          // 重新计算24小时成交量
          this.updateWindowVolume(window);
        }
      } catch (error) {
        this.logger.warn(`更新 ${symbol} 数据失败:`, error);
      }

      await this.delay(this.requestDelay);
    }
  }

  /**
   * 加载指定交易对的K线数据
   */
  private async loadSymbolKlines(
    symbol: string,
    startTime: Date,
    endTime: Date
  ): Promise<KlineData[] | null> {
    try {
      const response = await axios.get(`${this.binanceApiUrl}/api/v3/klines`, {
        params: {
          symbol,
          interval: '1h',
          startTime: startTime.getTime(),
          endTime: endTime.getTime(),
          limit: 1000,
        },
      });

      return response.data.map(kline => ({
        openTime: kline[0],
        open: kline[1],
        high: kline[2],
        low: kline[3],
        close: kline[4],
        volume: kline[5],
        closeTime: kline[6],
        quoteVolume: kline[7],
        count: kline[8],
        takerBuyVolume: kline[9],
        takerBuyQuoteVolume: kline[10],
      }));
    } catch (error) {
      this.logger.warn(`获取 ${symbol} K线数据失败:`, error);
      return null;
    }
  }

  /**
   * 更新窗口成交量统计
   */
  private updateWindowVolume(window: VolumeWindow): void {
    window.volume24h = window.data.reduce((sum, kline) => sum + parseFloat(kline.volume), 0);
    window.quoteVolume24h = window.data.reduce((sum, kline) => sum + parseFloat(kline.quoteVolume), 0);
  }

  /**
   * 计算排行榜
   */
  private calculateRankings(
    volumeWindows: Map<string, VolumeWindow>,
    limit: number,
    minVolumeThreshold: number
  ): HourlyVolumeRankingItem[] {
    const rankings: HourlyVolumeRankingItem[] = [];

    for (const [symbol, window] of volumeWindows) {
      if (window.quoteVolume24h >= minVolumeThreshold && window.data.length > 0) {
        const latestKline = window.data[window.data.length - 1];
        const baseAsset = symbol.replace('USDT', '').replace('BTC', '').replace('ETH', '');
        const quoteAsset = symbol.includes('USDT') ? 'USDT' : symbol.includes('BTC') ? 'BTC' : 'ETH';

        rankings.push({
          rank: 0, // 将在排序后设置
          symbol,
          baseAsset,
          quoteAsset,
          volume24h: window.volume24h,
          quoteVolume24h: window.quoteVolume24h,
          marketShare: 0, // 将在计算总量后设置
          hourlyChange: 0, // TODO: 实现排名变化计算
          priceAtTime: parseFloat(latestKline.close),
          volumeChangePercent: 0, // TODO: 实现成交量变化计算
        });
      }
    }

    // 按成交金额排序
    rankings.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);

    // 设置排名和市场份额
    const totalQuoteVolume = rankings.reduce((sum, item) => sum + item.quoteVolume24h, 0);
    rankings.forEach((item, index) => {
      item.rank = index + 1;
      item.marketShare = totalQuoteVolume > 0 ? (item.quoteVolume24h / totalQuoteVolume) * 100 : 0;
    });

    return rankings.slice(0, limit);
  }

  /**
   * 计算市场统计数据
   */
  private calculateMarketStats(rankings: HourlyVolumeRankingItem[]) {
    return {
      totalVolume: rankings.reduce((sum, item) => sum + item.volume24h, 0),
      totalQuoteVolume: rankings.reduce((sum, item) => sum + item.quoteVolume24h, 0),
      activePairs: rankings.length,
    };
  }

  /**
   * 计算市场集中度（前10名份额）
   */
  private calculateMarketConcentration(rankings: HourlyVolumeRankingItem[]): number {
    const top10Volume = rankings.slice(0, 10).reduce((sum, item) => sum + item.quoteVolume24h, 0);
    const totalVolume = rankings.reduce((sum, item) => sum + item.quoteVolume24h, 0);
    return totalVolume > 0 ? (top10Volume / totalVolume) * 100 : 0;
  }

  /**
   * 保存回测结果到数据库
   */
  private async saveBacktestResults(results: VolumeBacktest[]): Promise<void> {
    try {
      await this.volumeBacktestModel.insertMany(results);
      this.logger.log(`保存了 ${results.length} 条回测记录到数据库`);
    } catch (error) {
      this.logger.error('保存回测结果失败:', error);
    }
  }

  /**
   * 查询历史回测数据
   */
  async getBacktestResults(
    startTime?: Date,
    endTime?: Date,
    symbol?: string
  ): Promise<VolumeBacktest[]> {
    const query: any = {};
    
    if (startTime || endTime) {
      query.timestamp = {};
      if (startTime) query.timestamp.$gte = startTime;
      if (endTime) query.timestamp.$lte = endTime;
    }
    
    if (symbol) {
      query['rankings.symbol'] = symbol;
    }

    return this.volumeBacktestModel.find(query).sort({ timestamp: 1 }).exec();
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 测试Binance API连通性
   */
  async testBinanceApi() {
    try {
      this.logger.log('开始测试Binance API连通性...');
      
      // 检查服务器时间
      const timeResponse = await axios.get(`${this.binanceApiUrl}/api/v3/time`, {
        timeout: 5000,
      });
      const serverTime = timeResponse.data.serverTime;
      this.logger.log(`Binance服务器时间: ${new Date(serverTime).toISOString()}`);
      
      return {
        success: true,
        serverTime: new Date(serverTime).toISOString(),
        message: 'Binance API连接正常'
      };
    } catch (error) {
      this.logger.error('Binance API连通性测试失败:', error);
      throw error;
    }
  }
}
