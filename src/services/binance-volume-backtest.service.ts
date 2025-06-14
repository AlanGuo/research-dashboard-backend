import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VolumeBacktest, VolumeBacktestDocument, HourlyVolumeRankingItem } from '../models/volume-backtest.model';
import { VolumeBacktestParamsDto, VolumeBacktestResponse } from '../dto/volume-backtest-params.dto';
import { ConfigService } from '../config/config.service';
import { BinanceService } from './binance.service';

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

  // 常见稳定币列表（基础资产）
  private readonly STABLECOINS = [
    'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'USDD', 'FRAX',
    'FDUSD', 'PYUSD', 'LUSD', 'GUSD', 'SUSD', 'HUSD', 'OUSD', 'USDK',
    'USDN', 'UST', 'USTC', 'CUSD', 'DOLA', 'USDX', 'RSR', 'TRIBE'
  ];

  constructor(
    @InjectModel(VolumeBacktest.name)
    private volumeBacktestModel: Model<VolumeBacktestDocument>,
    private readonly configService: ConfigService,
    private readonly binanceService: BinanceService,
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
      const allActiveSymbols = await this.getActiveSymbols(params);
      this.logger.log(`🔍 获取到 ${allActiveSymbols.length} 个活跃交易对`);
      
      // 2. 筛选有足够历史数据的交易对
      const symbolFilter = await this.filterValidSymbols(
        allActiveSymbols, 
        startTime, 
        params.minHistoryDays || 365,
        params.requireFutures || false,
        params.excludeStablecoins ?? true  // 默认排除稳定币
      );
      const activeSymbols = symbolFilter.valid;
      
      this.logger.log(`✅ 筛选完成: ${activeSymbols.length}/${allActiveSymbols.length} 个交易对符合所有条件`);
      
      if (activeSymbols.length === 0) {
        throw new Error('没有找到符合条件的交易对，请检查时间范围和参数设置');
      }
      
      // 3. 计算需要处理的小时数
      const totalHours = Math.ceil((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60));
      this.logger.log(`📊 将处理 ${activeSymbols.length} 个交易对的 ${totalHours} 小时数据`);

      // 4. 执行回测计算
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
          symbolStats: {
            totalDiscovered: allActiveSymbols.length,
            validSymbols: activeSymbols.length,
            invalidSymbols: symbolFilter.invalid.length,
            validRate: ((activeSymbols.length / allActiveSymbols.length) * 100).toFixed(1) + '%',
            sampleInvalidSymbols: symbolFilter.invalid.slice(0, 10),
            filterCriteria: {
              minHistoryDays: params.minHistoryDays || 365,
              requireFutures: params.requireFutures || false,
              excludeStablecoins: params.excludeStablecoins ?? true,
            },
            invalidReasons: this.aggregateInvalidReasons(symbolFilter.invalidReasons),
          },
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
      const exchangeInfo = await this.binanceService.getExchangeInfo();
      const symbols = exchangeInfo.symbols
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
   * 计算指定粒度的成交量排行榜
   */
  private async calculateHourlyRankings(
    symbols: string[],
    startTime: Date,
    endTime: Date,
    params: VolumeBacktestParamsDto
  ): Promise<VolumeBacktest[]> {
    const results: VolumeBacktest[] = [];
    const volumeWindows = new Map<string, VolumeWindow>();

    // 设置回测粒度（可配置，默认8小时）
    const BACKTEST_GRANULARITY_HOURS = params.granularityHours || 8;
    
    // 计算总的小时数和周期数
    const totalHours = Math.ceil((endTime.getTime() - startTime.getTime()) / (60 * 60 * 1000));
    const totalPeriods = Math.ceil(totalHours / BACKTEST_GRANULARITY_HOURS);
    this.logger.log(`📊 开始回测，总共需要处理 ${totalHours} 小时的数据，按每${BACKTEST_GRANULARITY_HOURS}小时粒度计算，共${totalPeriods}个周期`);

    // 初始化滑动窗口
    for (const symbol of symbols) {
      volumeWindows.set(symbol, {
        symbol,
        data: [],
        volume24h: 0,
        quoteVolume24h: 0,
      });
    }

    // 预加载前24小时的数据作为初始窗口（使用带重试机制的方法）
    const preLoadStart = new Date(startTime.getTime() - 24 * 60 * 60 * 1000);
    await this.preloadVolumeWindowsWithRetry(volumeWindows, preLoadStart, startTime);

    // 按指定粒度处理数据
    const currentTime = new Date(startTime);
    let processedPeriods = 0;
    
    while (currentTime < endTime) {
      const periodStart = Date.now();
      processedPeriods++;
      
      // 显示当前周期进度
      const progress = ((processedPeriods / totalPeriods) * 100).toFixed(1);
      this.logger.log(`⏳ 处理进度: ${processedPeriods}/${totalPeriods} (${progress}%) - 时间点: ${currentTime.toISOString()} (每${BACKTEST_GRANULARITY_HOURS}小时周期)`);

      // 更新滑动窗口（加载当前时间点前N小时的所有数据）
      await this.updateVolumeWindowsForPeriod(volumeWindows, currentTime, BACKTEST_GRANULARITY_HOURS);

      // 根据周期数调整统计频率
      const logFrequency = Math.max(1, Math.floor(totalPeriods / 10));
      if (processedPeriods % logFrequency === 0) {
        this.logDataStatistics(volumeWindows, `第${processedPeriods}个${BACKTEST_GRANULARITY_HOURS}小时周期后`);
      }

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
        calculationDuration: Date.now() - periodStart,
      });

      // 移动到下一个周期
      currentTime.setHours(currentTime.getHours() + BACKTEST_GRANULARITY_HOURS);
    }

    this.logger.log(`✅ 成交量回测完成，共处理 ${processedPeriods} 个${BACKTEST_GRANULARITY_HOURS}小时周期的数据`);

    // 最终数据完整性检查
    await this.finalDataIntegrityCheck(volumeWindows, startTime, endTime);

    return results;
  }

  /**
   * 更新滑动窗口数据（带重试机制）
   */
  private async updateVolumeWindows(
    volumeWindows: Map<string, VolumeWindow>,
    currentTime: Date
  ): Promise<void> {
    const hourStart = currentTime.getTime();
    const hourEnd = hourStart + 60 * 60 * 1000;
    const window24hStart = hourStart - 24 * 60 * 60 * 1000;

    const failedSymbols: string[] = [];

    // 第一轮：尝试获取所有交易对的数据
    for (const [symbol, window] of volumeWindows) {
      try {
        // 获取当前小时的K线数据（已经包含重试机制）
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
        } else {
          failedSymbols.push(symbol);
        }
      } catch (error) {
        this.logger.warn(`更新 ${symbol} 数据失败:`, error);
        failedSymbols.push(symbol);
      }

      await this.delay(this.configService.binanceRequestDelay);
    }

    // 第二轮：处理失败的交易对
    if (failedSymbols.length > 0) {
      this.logger.log(`🔄 ${failedSymbols.length} 个交易对数据获取失败，开始重试...`);
      
      for (const symbol of failedSymbols) {
        try {
          // 增加重试次数为2次
          const newKlines = await this.loadSymbolKlines(
            symbol,
            new Date(hourStart),
            new Date(hourEnd),
            2 // 重试2次
          );

          if (newKlines && newKlines.length > 0) {
            const window = volumeWindows.get(symbol);
            if (window) {
              window.data.push(...newKlines);
              window.data = window.data.filter(kline => kline.openTime >= window24hStart);
              this.updateWindowVolume(window);
              this.logger.log(`✅ 重试成功获取 ${symbol} 数据`);
            }
          } else {
            this.logger.warn(`❌ 重试后仍无法获取 ${symbol} 数据`);
          }
        } catch (error) {
          this.logger.error(`❌ 重试 ${symbol} 时出错:`, error);
        }

        // 重试时使用更长的延迟
        await this.delay(this.configService.binanceRequestDelay * 2);
      }
    }
  }

  /**
   * 更新滑动窗口数据（8小时周期版本）
   */
  private async updateVolumeWindowsForPeriod(
    volumeWindows: Map<string, VolumeWindow>,
    currentTime: Date,
    periodHours: number = 8
  ): Promise<void> {
    // 计算当前周期的时间范围
    const periodStart = currentTime.getTime() - (periodHours * 60 * 60 * 1000);
    const periodEnd = currentTime.getTime();
    const window24hStart = currentTime.getTime() - 24 * 60 * 60 * 1000;

    this.logger.log(`🔄 开始更新滑动窗口数据，周期: ${new Date(periodStart).toISOString()} - ${new Date(periodEnd).toISOString()}`);

    const failedSymbols: string[] = [];
    let successCount = 0;

    // 第一轮：尝试获取所有交易对的数据
    for (const [symbol, window] of volumeWindows) {
      try {
        // 获取当前周期的所有K线数据（已经包含重试机制）
        const newKlines = await this.loadSymbolKlines(
          symbol,
          new Date(periodStart),
          new Date(periodEnd)
        );

        if (newKlines && newKlines.length > 0) {
          // 添加新数据
          window.data.push(...newKlines);

          // 移除超过24小时的旧数据
          window.data = window.data.filter(kline => kline.openTime >= window24hStart);

          // 重新计算24小时成交量
          this.updateWindowVolume(window);
          successCount++;
        } else {
          failedSymbols.push(symbol);
        }
      } catch (error) {
        this.logger.warn(`更新 ${symbol} 数据失败:`, error);
        failedSymbols.push(symbol);
      }

      await this.delay(this.configService.binanceRequestDelay);
    }

    this.logger.log(`✅ 第一轮数据获取完成：成功${successCount}个，失败${failedSymbols.length}个`);

    // 第二轮：处理失败的交易对
    if (failedSymbols.length > 0) {
      this.logger.log(`🔄 ${failedSymbols.length} 个交易对数据获取失败，开始重试...`);
      
      let retrySuccessCount = 0;
      
      for (const symbol of failedSymbols) {
        try {
          // 增加重试次数为2次
          const newKlines = await this.loadSymbolKlines(
            symbol,
            new Date(periodStart),
            new Date(periodEnd),
            2 // 重试2次
          );

          if (newKlines && newKlines.length > 0) {
            const window = volumeWindows.get(symbol);
            if (window) {
              window.data.push(...newKlines);
              window.data = window.data.filter(kline => kline.openTime >= window24hStart);
              this.updateWindowVolume(window);
              retrySuccessCount++;
              this.logger.log(`✅ 重试成功获取 ${symbol} 数据`);
            }
          } else {
            this.logger.warn(`❌ 重试后仍无法获取 ${symbol} 数据`);
          }
        } catch (error) {
          this.logger.error(`❌ 重试 ${symbol} 时出错:`, error);
        }

        // 重试时使用更长的延迟
        await this.delay(this.configService.binanceRequestDelay * 2);
      }
      
      this.logger.log(`🔄 重试完成：额外成功${retrySuccessCount}个，最终失败${failedSymbols.length - retrySuccessCount}个`);
    }
  }

  /**
   * 加载指定交易对的K线数据（带重试机制）
   */
  private async loadSymbolKlines(
    symbol: string,
    startTime: Date,
    endTime: Date,
    maxRetries: number = 3
  ): Promise<KlineData[] | null> {
    const timeRange = `${startTime.toISOString().slice(0, 16)} - ${endTime.toISOString().slice(0, 16)}`;
    this.logger.debug(`🔍 开始获取 ${symbol} K线数据 (${timeRange})`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const klines = await this.binanceService.getKlines({
          symbol,
          interval: '1h',
          startTime: startTime.getTime(),
          endTime: endTime.getTime(),
          limit: 1000,
        });
        
        if (attempt > 1) {
          this.logger.log(`✅ ${symbol} K线数据重试获取成功 - 第${attempt}次尝试，获得${klines?.length || 0}条数据`);
        } else {
          this.logger.debug(`✅ ${symbol} K线数据获取成功 - 获得${klines?.length || 0}条数据`);
        }
        
        return klines;
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const errorMsg = error.response?.data?.msg || error.message || '未知错误';
        
        if (isLastAttempt) {
          this.logger.error(`❌ ${symbol} K线数据最终获取失败 (${timeRange})`);
          this.logger.error(`   已重试 ${maxRetries} 次，错误: ${errorMsg}`);
          return null;
        } else {
          this.logger.warn(`⚠️ ${symbol} K线数据获取失败 (${timeRange})`);
          this.logger.warn(`   第 ${attempt}/${maxRetries} 次重试，错误: ${errorMsg}`);
          
          // 指数退避策略：每次失败后等待时间翻倍
          const delayTime = this.configService.binanceRequestDelay * Math.pow(2, attempt - 1);
          this.logger.debug(`   等待 ${delayTime}ms 后重试...`);
          await this.delay(delayTime);
        }
      }
    }
    return null;
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
    return this.binanceService.testConnectivity();
  }

  /**
   * 测试期货API连通性
   */
  async testFuturesApi() {
    return this.binanceService.testFuturesConnectivity();
  }

  /**
   * 重新获取失败的数据
   */
  private async retryFailedData(
    volumeWindows: Map<string, VolumeWindow>,
    startTime: Date,
    endTime: Date,
    maxRetries: number = 2
  ): Promise<{ success: number; failed: string[] }> {
    const failedSymbols: string[] = [];
    let successCount = 0;

    // 找出数据获取失败的交易对（数据为空或数据量过少）
    for (const [symbol, window] of volumeWindows) {
      if (!window.data || window.data.length === 0) {
        failedSymbols.push(symbol);
      }
    }

    if (failedSymbols.length === 0) {
      this.logger.log('没有需要重新获取的失败数据');
      return { success: 0, failed: [] };
    }

    this.logger.log(`🔄 开始重新获取 ${failedSymbols.length} 个失败的交易对数据`);
    
    if (failedSymbols.length > 0) {
      this.logger.log(`   失败交易对列表: ${failedSymbols.slice(0, 10).join(', ')}${failedSymbols.length > 10 ? '...' : ''}`);
    }

    // 分批重新获取失败的数据
    const batchSize = 5; // 失败重试时使用更小的批次
    const stillFailedSymbols: string[] = [];

    for (let i = 0; i < failedSymbols.length; i += batchSize) {
      const batch = failedSymbols.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(failedSymbols.length / batchSize);
      
      this.logger.log(`🔄 重试批次 ${batchNum}/${totalBatches}: ${batch.join(', ')}`);
      
      for (const symbol of batch) {
        const timeRange = `${startTime.toISOString().slice(0, 16)} - ${endTime.toISOString().slice(0, 16)}`;
        
        try {
          const klines = await this.loadSymbolKlines(symbol, startTime, endTime, maxRetries);
          
          if (klines && klines.length > 0) {
            const window = volumeWindows.get(symbol);
            if (window) {
              window.data = klines;
              this.updateWindowVolume(window);
              successCount++;
              this.logger.log(`✅ 成功重新获取 ${symbol} 数据 (${klines.length}条K线, ${timeRange})`);
            }
          } else {
            stillFailedSymbols.push(symbol);
            this.logger.warn(`❌ 重试后仍然无法获取 ${symbol} 数据 (${timeRange})`);
          }
        } catch (error) {
          stillFailedSymbols.push(symbol);
          this.logger.error(`❌ 重新获取 ${symbol} 数据时出错 (${timeRange}): ${error.message}`);
        }

        // 重试时使用更长的延迟
        await this.delay(this.configService.binanceRequestDelay * 2);
      }
    }

    this.logger.log(`🔄 重新获取完成：成功 ${successCount} 个，仍然失败 ${stillFailedSymbols.length} 个`);
    
    return { 
      success: successCount, 
      failed: stillFailedSymbols 
    };
  }

  /**
   * 改进的批量预加载方法（带错误处理和重试）
   */
  private async preloadVolumeWindowsWithRetry(
    volumeWindows: Map<string, VolumeWindow>,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    this.logger.log('📊 开始预加载初始数据窗口（带重试机制）...');
    
    const batchSize = 10;
    const symbols = Array.from(volumeWindows.keys());
    const totalBatches = Math.ceil(symbols.length / batchSize);
    
    this.logger.log(`📦 需要处理 ${symbols.length} 个交易对，分为 ${totalBatches} 个批次`);
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      const progress = ((batchNumber / totalBatches) * 100).toFixed(1);
      const sampleSymbols = batch.slice(0, 3).join(', ') + (batch.length > 3 ? '...' : '');
      this.logger.log(`⏳ 预加载进度: ${batchNumber}/${totalBatches} (${progress}%) - 处理: ${sampleSymbols}`);
      
      // 改进的批量处理：逐个处理而不是Promise.all，避免单个失败影响整批
      let batchSuccessCount = 0;
      let batchFailCount = 0;
      
      for (const symbol of batch) {
        try {
          const klines = await this.loadSymbolKlines(symbol, startTime, endTime);
          const window = volumeWindows.get(symbol);
          
          if (window && klines && klines.length > 0) {
            window.data = klines;
            this.updateWindowVolume(window);
            batchSuccessCount++;
          } else if (window) {
            this.logger.warn(`⚠️ ${symbol} 预加载数据为空 (时间段: ${startTime.toISOString().slice(0, 16)} - ${endTime.toISOString().slice(0, 16)})`);
            batchFailCount++;
          }
        } catch (error) {
          this.logger.warn(`⚠️ 预加载 ${symbol} 失败: ${error.message}`);
          batchFailCount++;
        }

        // API限流控制
        await this.delay(this.configService.binanceRequestDelay);
      }
      
      // 记录批次处理结果
      this.logger.log(`📊 批次 ${batchNumber} 完成: 成功 ${batchSuccessCount}/${batch.length}, 失败 ${batchFailCount}/${batch.length}`);
    }

    // 预加载完成后，尝试重新获取失败的数据
    const retryResult = await this.retryFailedData(volumeWindows, startTime, endTime);
    
    // 记录最终统计信息
    this.logDataStatistics(volumeWindows, '预加载完成后');
    
    const stats = this.calculateDataSuccessRate(volumeWindows);
    if (stats.successRate < 90) {
      this.logger.warn(`⚠️ 数据获取成功率较低 (${stats.successRate.toFixed(1)}%)，可能影响回测准确性`);
    }
  }

  /**
   * 最终数据完整性检查和修复
   */
  private async finalDataIntegrityCheck(
    volumeWindows: Map<string, VolumeWindow>,
    startTime: Date,
    endTime: Date
  ): Promise<void> {
    this.logger.log('🔍 开始最终数据完整性检查...');
    
    const stats = this.calculateDataSuccessRate(volumeWindows);
    
    if (stats.failed === 0) {
      this.logger.log('✅ 所有交易对数据完整');
      return;
    }
    
    this.logger.warn(`🚨 发现 ${stats.failed} 个交易对数据不完整，开始最终修复...`);
    
    // 对于数据不完整的交易对，尝试最后一次修复
    const repairPromises = stats.failedSymbols.map(async (symbol) => {
      try {
        // 计算整个回测期间的数据
        const fullPeriodKlines = await this.loadSymbolKlines(
          symbol, 
          new Date(startTime.getTime() - 24 * 60 * 60 * 1000), // 包括预加载期
          endTime,
          2 // 最多重试2次
        );
        
        if (fullPeriodKlines && fullPeriodKlines.length > 0) {
          const window = volumeWindows.get(symbol);
          if (window) {
            window.data = fullPeriodKlines;
            this.updateWindowVolume(window);
            this.logger.log(`🔧 成功修复 ${symbol} 的数据`);
            return { symbol, success: true };
          }
        }
        
        this.logger.warn(`🔧 无法修复 ${symbol} 的数据`);
        return { symbol, success: false };
      } catch (error) {
        this.logger.error(`🔧 修复 ${symbol} 时出错:`, error);
        return { symbol, success: false };
      }
    });
    
    const repairResults = await Promise.all(repairPromises);
    const repairedCount = repairResults.filter(r => r.success).length;
    const stillFailedCount = repairResults.filter(r => !r.success).length;
    
    this.logger.log(`🔧 数据修复完成: 成功修复 ${repairedCount} 个，仍然失败 ${stillFailedCount} 个`);
    
    // 最终统计
    this.logDataStatistics(volumeWindows, '最终数据完整性检查');
  }

  /**
   * 筛选有效的交易对（有足够历史数据的）
   */
  private async filterValidSymbols(
    symbols: string[],
    startTime: Date,
    minHistoryDays: number = 365,
    requireFutures: boolean = false,
    excludeStablecoins: boolean = true
  ): Promise<{ 
    valid: string[]; 
    invalid: string[];
    invalidReasons: { [symbol: string]: string[] };
  }> {
    this.logger.log(`🔍 开始筛选有效交易对...`);
    this.logger.log(`   历史数据要求: 至少${minHistoryDays}天`);
    this.logger.log(`   期货合约要求: ${requireFutures ? '必须有永续合约' : '无要求'}`);
    this.logger.log(`   稳定币过滤: ${excludeStablecoins ? '排除稳定币' : '包含稳定币'}`);
    if (excludeStablecoins) {
      this.logger.log(`   排除的稳定币: ${this.STABLECOINS.slice(0, 10).join(', ')}${this.STABLECOINS.length > 10 ? '...' : ''}`);
    }
    const validSymbols: string[] = [];
    const invalidSymbols: string[] = [];
    const invalidReasons: { [symbol: string]: string[] } = {};
    
    // 计算需要检查的历史时间点（回测开始时间向前推N天）
    const requiredHistoryStart = new Date(startTime.getTime() - minHistoryDays * 24 * 60 * 60 * 1000);
    const checkEndTime = new Date(startTime.getTime() - 7 * 24 * 60 * 60 * 1000); // 回测前一周
    
    this.logger.log(`📅 检查历史数据范围: ${requiredHistoryStart.toISOString().slice(0, 10)} 至 ${checkEndTime.toISOString().slice(0, 10)}`);
    
    // 如果需要检查期货合约，先批量获取期货合约信息
    let futuresAvailability: { [symbol: string]: boolean } = {};
    if (requireFutures) {
      this.logger.log(`🔍 检查期货合约可用性...`);
      try {
        futuresAvailability = await this.binanceService.checkFuturesAvailability(symbols);
        const withFutures = Object.values(futuresAvailability).filter(Boolean).length;
        this.logger.log(`📊 期货合约检查完成: ${withFutures}/${symbols.length} 个交易对有永续合约`);
      } catch (error) {
        this.logger.error(`期货合约检查失败: ${error.message}`);
        // 如果期货检查失败但是要求期货，则所有都标记为无效
        symbols.forEach(symbol => futuresAvailability[symbol] = false);
      }
    }
    
    const batchSize = 15; // 筛选时使用较大批次提高效率
    const totalBatches = Math.ceil(symbols.length / batchSize);
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      const progress = ((batchNumber / totalBatches) * 100).toFixed(1);
      this.logger.log(`⏳ 筛选进度: ${batchNumber}/${totalBatches} (${progress}%) - 检查: ${batch.slice(0, 3).join(', ')}${batch.length > 3 ? '...' : ''}`);
      
      // 批量检查交易对的历史数据
      for (const symbol of batch) {
        const reasons: string[] = [];
        let isValid = true;
        
        try {
          // 检查1: 稳定币过滤
          if (excludeStablecoins && this.isStablecoinPair(symbol)) {
            reasons.push('稳定币交易对');
            isValid = false;
          }
          
          // 检查2: 期货合约要求
          if (requireFutures && !futuresAvailability[symbol]) {
            reasons.push('无永续合约');
            isValid = false;
          }
          
          // 检查3: 历史数据要求
          const hasValidHistory = await this.checkSymbolHistoryData(
            symbol,
            requiredHistoryStart,
            checkEndTime
          );
          
          if (!hasValidHistory) {
            reasons.push(`历史数据不足${minHistoryDays}天`);
            isValid = false;
          }
          
          if (isValid) {
            validSymbols.push(symbol);
            this.logger.debug(`✅ ${symbol} 通过所有筛选条件`);
          } else {
            invalidSymbols.push(symbol);
            invalidReasons[symbol] = reasons;
            this.logger.debug(`❌ ${symbol} 不符合条件: ${reasons.join(', ')}`);
          }
        } catch (error) {
          // 如果检查过程中出错，也认为是无效的
          invalidSymbols.push(symbol);
          invalidReasons[symbol] = [`检查失败: ${error.message}`];
          this.logger.warn(`⚠️ ${symbol} 检查失败: ${error.message}`);
        }
        
        // 控制API调用频率
        await this.delay(this.configService.binanceRequestDelay);
      }
      
      // 显示批次结果
      const batchValid = batch.filter(s => validSymbols.includes(s)).length;
      const batchInvalid = batch.filter(s => invalidSymbols.includes(s)).length;
      this.logger.log(`📊 批次 ${batchNumber} 结果: 有效 ${batchValid}/${batch.length}, 无效 ${batchInvalid}/${batch.length}`);
    }
    
    const validRate = ((validSymbols.length / symbols.length) * 100).toFixed(1);
    this.logger.log(`✅ 交易对筛选完成:`);
    this.logger.log(`   总数: ${symbols.length}`);
    this.logger.log(`   有效: ${validSymbols.length} (${validRate}%)`);
    this.logger.log(`   无效: ${invalidSymbols.length} (${(100 - parseFloat(validRate)).toFixed(1)}%)`);
    
    if (invalidSymbols.length > 0) {
      // 统计失败原因
      const reasonStats: { [reason: string]: number } = {};
      Object.values(invalidReasons).forEach(reasons => {
        reasons.forEach(reason => {
          reasonStats[reason] = (reasonStats[reason] || 0) + 1;
        });
      });
      
      this.logger.log(`   失败原因统计:`);
      Object.entries(reasonStats).forEach(([reason, count]) => {
        this.logger.log(`     - ${reason}: ${count} 个`);
      });
      
      const sampleInvalid = invalidSymbols.slice(0, 5);
      this.logger.log(`   无效交易对示例: ${sampleInvalid.map(s => `${s}(${invalidReasons[s].join(',')})`).join(', ')}${invalidSymbols.length > 5 ? '...' : ''}`);
    }
    
    return { valid: validSymbols, invalid: invalidSymbols, invalidReasons };
  }

  /**
   * 检查单个交易对的历史数据是否充足
   */
  private async checkSymbolHistoryData(
    symbol: string,
    historyStart: Date,
    historyEnd: Date
  ): Promise<boolean> {
    try {
      // 获取一小段历史数据来验证
      const testKlines = await this.binanceService.getKlines({
        symbol,
        interval: '1d', // 使用日线数据检查，更高效
        startTime: historyStart.getTime(),
        endTime: historyEnd.getTime(),
        limit: 10, // 只需要少量数据验证
      });
      
      // 检查是否有足够的历史数据
      if (!testKlines || testKlines.length === 0) {
        return false;
      }
      
      // 检查最早的数据是否足够早
      const earliestTime = testKlines[0].openTime;
      const requiredTime = historyStart.getTime();
      
      // 如果最早数据距离要求时间不超过30天，认为是有效的
      const timeDifference = Math.abs(earliestTime - requiredTime);
      const daysDifference = timeDifference / (24 * 60 * 60 * 1000);
      
      return daysDifference <= 30; // 允许30天的误差
      
    } catch (error) {
      // 如果API调用失败，可能是交易对不存在或已下架
      if (error.response?.status === 400 && error.response?.data?.code === -1121) {
        // 无效交易对符号
        this.logger.debug(`${symbol} 交易对不存在或已下架`);
        return false;
      }
      
      // 其他错误（如网络问题）暂时认为是有效的，后续再处理
      this.logger.debug(`${symbol} 历史数据检查出错，暂时保留: ${error.message}`);
      return true;
    }
  }

  /**
   * 统计数据获取成功率
   */
  private calculateDataSuccessRate(volumeWindows: Map<string, VolumeWindow>): {
    total: number;
    successful: number;
    failed: number;
    successRate: number;
    failedSymbols: string[];
  } {
    const total = volumeWindows.size;
    const failedSymbols: string[] = [];
    
    for (const [symbol, window] of volumeWindows) {
      if (!window.data || window.data.length === 0) {
        failedSymbols.push(symbol);
      }
    }
    
    const failed = failedSymbols.length;
    const successful = total - failed;
    const successRate = total > 0 ? (successful / total) * 100 : 0;
    
    return {
      total,
      successful,
      failed,
      successRate,
      failedSymbols
    };
  }

  /**
   * 记录数据获取统计信息
   */
  private logDataStatistics(volumeWindows: Map<string, VolumeWindow>, context: string): void {
    const stats = this.calculateDataSuccessRate(volumeWindows);
    
    this.logger.log(`📊 ${context} 数据统计:`);
    this.logger.log(`   总交易对数: ${stats.total}`);
    this.logger.log(`   成功获取: ${stats.successful} (${stats.successRate.toFixed(1)}%)`);
    
    if (stats.failed > 0) {
      this.logger.warn(`   获取失败: ${stats.failed} (${(100 - stats.successRate).toFixed(1)}%)`);
      
      // 显示前几个失败的交易对
      const sampleFailed = stats.failedSymbols.slice(0, 5);
      this.logger.warn(`   失败交易对示例: ${sampleFailed.join(', ')}${stats.failedSymbols.length > 5 ? '...' : ''}`);
    }
  }

  /**
   * 聚合无效原因统计
   */
  private aggregateInvalidReasons(invalidReasons: { [symbol: string]: string[] }): { [reason: string]: number } {
    const reasonStats: { [reason: string]: number } = {};
    
    Object.values(invalidReasons).forEach(reasons => {
      reasons.forEach(reason => {
        reasonStats[reason] = (reasonStats[reason] || 0) + 1;
      });
    });
    
    return reasonStats;
  }

  /**
   * 检查交易对是否为稳定币相关
   */
  private isStablecoinPair(symbol: string): boolean {
    // 提取基础资产（去除报价资产）
    const baseAsset = this.extractBaseAsset(symbol);
    return this.STABLECOINS.includes(baseAsset);
  }

  /**
   * 从交易对中提取基础资产
   */
  private extractBaseAsset(symbol: string): string {
    // 常见的报价资产列表
    const quoteAssets = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'BUSD', 'FDUSD'];
    
    for (const quote of quoteAssets) {
      if (symbol.endsWith(quote)) {
        return symbol.slice(0, -quote.length);
      }
    }
    
    // 如果没有匹配到常见报价资产，返回整个symbol（可能是不常见的交易对）
    return symbol;
  }
}
