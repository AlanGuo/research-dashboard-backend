import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AssetTrend } from '../models/asset-trend.model';
import { GliTrendPeriod } from '../models/gli-trend.model';
import { TradingViewService } from './tradingview.service';
import { BenchmarkService } from './benchmark.service';
import { GliService } from './gli.service';

// 数据可用性状态
enum DataAvailabilityStatus {
  AVAILABLE = 'available',       // 数据可用
  TOO_EARLY = 'too_early',       // 资产在该时间点还不存在
  REQUEST_FAILED = 'req_failed', // 请求失败（网络错误、服务器错误等）
  RATE_LIMITED = 'rate_limited'  // 请求被限流
}

@Injectable()
export class AssetTrendService {
  private readonly logger = new Logger(AssetTrendService.name);
  
  constructor(
    @InjectModel('AssetTrend')
    private readonly assetTrendModel: Model<AssetTrend>,
    private readonly tradingViewService: TradingViewService,
    private readonly benchmarkService: BenchmarkService,
    private readonly gliService: GliService
  ) {}
  
  /**
   * 获取所有资产在各趋势期间的表现数据
   */
  public async getAllAssetTrends(): Promise<AssetTrend[]> {
    try {
      const trends = await this.assetTrendModel.find().sort({ category: 1, assetName: 1 });
      return trends;
    } catch (error) {
      this.logger.error('获取资产趋势表现数据失败', error);
      throw new Error('获取资产趋势表现数据失败');
    }
  }

  /**
   * 获取单个资产在各趋势期间的表现数据
   */
  public async getAssetTrend(assetId: string): Promise<AssetTrend | null> {
    try {
      const trend = await this.assetTrendModel.findOne({ assetId });
      return trend;
    } catch (error) {
      this.logger.error(`获取资产 ${assetId} 的趋势表现数据失败`, error);
      throw new Error(`获取资产 ${assetId} 的趋势表现数据失败`);
    }
  }

  /**
   * 计算并存储所有资产在各趋势期间的表现
   */
  public async calculateAndStoreAllAssetTrends(forceUpdate = false): Promise<AssetTrend[]> {
    try {
      console.log('\n开始获取趋势期间数据...');
      // 获取所有趋势期间
      const trendPeriods = await this.getTrendPeriods();
      console.log(`成功获取 ${trendPeriods.length} 个趋势期间`);
      
      console.log('开始获取对比标的数据...');
      // 获取所有对比标的
      const assets = await this.getBenchmarkAssets();
      console.log(`成功获取 ${assets.length} 个对比标的`);
      
      // 计算每个资产在每个趋势期间的表现
      const results: AssetTrend[] = [];
      
      // 创建进度跟踪器
      let processedAssets = 0;
      const totalAssets = assets.length;
      console.log(`\n开始处理 ${totalAssets} 个资产的趋势数据...`);
      
      console.log('\n开始顺序处理资产数据...');
      
      for (let index = 0; index < assets.length; index++) {
        const asset = assets[index];
        const startTime = Date.now();
        console.log(`\n[资产 ${index + 1}/${totalAssets}] 开始处理: ${asset.name} (${asset.symbol})`);
        
        try {
          // 检查数据库中是否已有该资产的数据，且不需要强制更新
          if (!forceUpdate) {
            const existingData = await this.assetTrendModel.findOne({ assetId: asset.id });
            if (existingData) {
              console.log(`  ✓ 使用缓存数据: ${asset.name} (数据库中已存在记录)`);
              processedAssets++;
              results.push(existingData);
              continue; // 跳过当前资产，处理下一个
            }
          }
          
          // 计算该资产在各趋势期间的表现
          console.log(`  获取 ${asset.name} 的趋势数据 (共 ${trendPeriods.length} 个趋势期间)...`);
          const assetTrend = await this.calculateAssetTrend(asset, trendPeriods);
          
          // 统计数据状态
          const statusCounts: Record<string, number> = {};
          assetTrend.performances.forEach(perf => {
            if (perf.dataStatus) {
              statusCounts[perf.dataStatus] = (statusCounts[perf.dataStatus] || 0) + 1;
            }
          });
          
          // 打印数据状态统计
          console.log('  数据状态统计:');
          Object.entries(statusCounts).forEach(([status, count]) => {
            const statusSymbol = status === DataAvailabilityStatus.AVAILABLE ? '✓' : 
                               status === DataAvailabilityStatus.TOO_EARLY ? '⌛' :
                               status === DataAvailabilityStatus.RATE_LIMITED ? '⚠' : '❗';
            console.log(`    ${statusSymbol} ${status}: ${count} 个期间`);
          });
          
          // 存储到数据库
          console.log(`  存储 ${asset.name} 的趋势数据到数据库...`);
          const upsertResult = await this.assetTrendModel.findOneAndUpdate(
            { assetId: asset.id },
            assetTrend,
            { upsert: true, new: true }
          );
          
          // 计算处理时间
          const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`  ✓ 完成 ${asset.name} 的处理 (耗时: ${processingTime}s)`);
          
          // 更新进度
          processedAssets++;
          results.push(upsertResult);
          
          // 在处理下一个资产前等待1秒，避免请求过快
          if (index < assets.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          this.logger.error(`处理资产 ${asset.name} 的趋势数据失败`, error);
          console.log(`  ❗ 错误: 处理 ${asset.name} 失败 - ${error.message || String(error)}`);
          
          // 更新进度
          processedAssets++;
          // 继续处理下一个资产
        }
      }
      
      console.log(`处理完成! 成功处理了 ${results.length}/${totalAssets} 个资产的趋势数据`);
      
      return results;
    } catch (error) {
      this.logger.error('计算并存储资产趋势表现数据失败', error);
      throw new Error('计算并存储资产趋势表现数据失败');
    }
  }

  /**
   * 计算单个资产在各趋势期间的表现
   */
  private async calculateAssetTrend(
    asset: any, 
    trendPeriods: GliTrendPeriod[]
  ): Promise<AssetTrend> {
    try {
      // 检查是否有趋势期间
      if (!trendPeriods || trendPeriods.length === 0) {
        return {
          assetId: asset.id,
          assetName: asset.name,
          assetSymbol: asset.symbol,
          category: asset.category,
          performances: [],
          lastUpdated: new Date()
        };
      }

      // 找出所有趋势期间中最早的开始日期和最晚的结束日期
      let earliestStartDate = new Date(trendPeriods[0].startDate).getTime();
      let latestEndDate = new Date(trendPeriods[0].endDate).getTime();

      for (const period of trendPeriods) {
        const startDate = new Date(period.startDate).getTime();
        const endDate = new Date(period.endDate).getTime();
        
        if (startDate < earliestStartDate) {
          earliestStartDate = startDate;
        }
        
        if (endDate > latestEndDate) {
          latestEndDate = endDate;
        }
      }
      
      // 创建存储各期间表现的数组
      const performances: any[] = [];

      // 如果所有期间都已处理完毕（全部为TOO_EARLY），直接返回结果
      if (performances.length === trendPeriods.length) {
        return {
          assetId: asset.id,
          assetName: asset.name,
          assetSymbol: asset.symbol,
          category: asset.category,
          performances,
          lastUpdated: new Date()
        };
      }

      try {
        // 转换为秒级时间戳
        const fromTimestampSec = Math.floor(earliestStartDate / 1000);
        const toTimestampSec = Math.floor(latestEndDate / 1000);
        
        // 使用分批获取方法获取所有需要的K线数据
        const allCandles = await this.fetchKlineDataInBatches(
          asset.id,
          '1D', // 使用日线数据计算涨跌幅
          fromTimestampSec,
          toTimestampSec
        );

        // 如果没有获取到数据，返回错误
        if (allCandles.length === 0) {
          // 处理所有未处理的期间
          for (const period of trendPeriods) {
            const periodId = `${period.startDate}_${period.endDate}`;
            // 检查是否已经处理过该期间
            if (!performances.some(p => p.periodId === periodId)) {
              performances.push({
                periodId,
                startDate: period.startDate,
                endDate: period.endDate,
                change: 0,
                dataStatus: DataAvailabilityStatus.TOO_EARLY,
                statusMessage: `该时间段没有 ${asset.name} 的数据`
              });
            }
          }
        } else {
          // 处理每个趋势期间
          for (const period of trendPeriods) {
            const periodId = `${period.startDate}_${period.endDate}`;
            
            // 检查是否已经处理过该期间（如TOO_EARLY）
            if (performances.some(p => p.periodId === periodId)) {
              continue;
            }

            const startDate = new Date(period.startDate).getTime();
            const endDate = new Date(period.endDate).getTime();

            // 过滤出该期间的K线数据
            const periodCandles = allCandles.filter(
              candle => candle.timestamp >= startDate && candle.timestamp <= endDate
            );

            if (periodCandles.length > 0) {
              // 计算该期间的涨跌幅
              const startPrice = periodCandles[0].close;
              const endPrice = periodCandles[periodCandles.length - 1].close;
              const change = ((endPrice - startPrice) / startPrice) * 100;

              performances.push({
                periodId,
                startDate: period.startDate,
                endDate: period.endDate,
                change,
                startPrice,
                endPrice,
                dataStatus: DataAvailabilityStatus.AVAILABLE,
                statusMessage: ``
              });
            } else {
              // 该期间没有数据
              performances.push({
                periodId,
                startDate: period.startDate,
                endDate: period.endDate,
                change: 0,
                dataStatus: DataAvailabilityStatus.TOO_EARLY,
                statusMessage: `该时间段没有 ${asset.name} 的数据`
              });
            }
          }
        }
      } catch (error) {
        // 处理API请求错误
        const errorMessage = error.message || String(error);
        const isRateLimited = errorMessage.includes('max sessions') || 
                              errorMessage.includes('rate limit') || 
                              errorMessage.includes('timeout');
        
        // 处理所有未处理的期间
        for (const period of trendPeriods) {
          const periodId = `${period.startDate}_${period.endDate}`;
          // 检查是否已经处理过该期间
          if (!performances.some(p => p.periodId === periodId)) {
            performances.push({
              periodId,
              startDate: period.startDate,
              endDate: period.endDate,
              change: 0,
              dataStatus: isRateLimited ? DataAvailabilityStatus.RATE_LIMITED : DataAvailabilityStatus.REQUEST_FAILED,
              statusMessage: isRateLimited ? 
                `请求被限流: ${errorMessage.substring(0, 50)}...` : 
                `请求失败: ${errorMessage.substring(0, 50)}...`
            });
          }
        }
      }

      // 构建资产趋势表现数据
      return {
        assetId: asset.id,
        assetName: asset.name,
        assetSymbol: asset.symbol,
        category: asset.category,
        performances,
        lastUpdated: new Date()
      };
    } catch (error) {
      this.logger.error(`计算资产 ${asset.name} 的趋势表现失败`, error);
      throw new Error(`计算资产 ${asset.name} 的趋势表现失败`);
    }  
  }

  /**
   * 获取所有趋势期间
   */
  private async getTrendPeriods(): Promise<GliTrendPeriod[]> {
    try {
      const trendPeriodsResponse = this.gliService.getTrendPeriods();
      if (trendPeriodsResponse.success && Array.isArray(trendPeriodsResponse.data)) {
        return trendPeriodsResponse.data;
      }
      return [];
    } catch (error) {
      this.logger.error('获取趋势期间数据失败', error);
      throw new Error('获取趋势期间数据失败');
    }
  }

  /**
   * 获取所有对比标的
   */
  private async getBenchmarkAssets(): Promise<any[]> {
    try {
      return this.benchmarkService.getAllBenchmarks();
    } catch (error) {
      this.logger.error('获取对比标的数据失败', error);
      throw new Error('获取对比标的数据失败');
    }
  }
  
  /**
   * 分批获取K线数据，处理单次请求最多1000条K线的限制
   * @param symbol 交易对符号
   * @param interval 时间间隔
   * @param fromTimestamp 开始时间戳（秒级）
   * @param toTimestamp 结束时间戳（秒级）
   * @returns 合并后的K线数据
   */
  private async fetchKlineDataInBatches(
    symbol: string,
    interval: string = '1D',
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<any[]> {
    try {
      // 计算需要获取的天数
      const daysDiff = Math.ceil((toTimestamp - fromTimestamp) / (86400));
      
      // 一次请求最多获取5000条K线数据
      const maxBatch = 5000;
      let allCandles: any[] = [];
      
      if (daysDiff <= maxBatch) {
        // 如果天数少于5000天，一次性获取所有数据
        const data = await this.tradingViewService.getKlineData(
          symbol,
          interval,
          daysDiff,
          toTimestamp
        );
        
        if (data && data.candles && Array.isArray(data.candles)) {
          allCandles = data.candles;
        }
      } else {
        // 需要分批获取数据
        const batches = Math.ceil(daysDiff / maxBatch);
        this.logger.log(`数据范围过大（${daysDiff}天），分${batches}批获取，每批${maxBatch}天`);
        
        let currentToTimestamp = toTimestamp;
        
        // 逐批获取数据
        for (let i = 0; i < batches; i++) {
          // 计算当前批次应获取的天数
          const currentBatchDays = (i === batches - 1) 
            ? (daysDiff - (maxBatch * (batches - 1))) // 最后一批可能不足maxBatch天
            : maxBatch;
          
          // 获取当前批次的数据
          const batchData = await this.tradingViewService.getKlineData(
            symbol,
            interval,
            currentBatchDays,
            currentToTimestamp
          );
          
          if (batchData && batchData.candles && batchData.candles.length > 0) {
            // 合并K线数据
            allCandles = [...allCandles, ...batchData.candles];
            
            // 如果获取到的K线数量小于请求的数量，说明没有更多历史数据了
            if (batchData.candles.length < currentBatchDays) {
              this.logger.log(`获取到的K线数量(${batchData.candles.length})小于请求的数量(${currentBatchDays})，没有更多历史数据了，停止获取`);
              break;
            }
            
            // 更新下一批次的结束时间戳
            // 找到当前批次中最早的日期
            const earliestCandleInBatch = batchData.candles[batchData.candles.length - 1];
            if (earliestCandleInBatch && earliestCandleInBatch.datetime) {
              const earliestDate = new Date(earliestCandleInBatch.datetime);
              // 往前推一天作为下一批次的结束时间
              earliestDate.setDate(earliestDate.getDate() - 1);
              currentToTimestamp = Math.floor(earliestDate.getTime() / 1000);
            } else {
              // 如果无法确定最早日期，则按照当前批次天数向前推进
              const currentDate = new Date(currentToTimestamp * 1000);
              currentDate.setDate(currentDate.getDate() - currentBatchDays);
              currentToTimestamp = Math.floor(currentDate.getTime() / 1000);
            }
          } else {
            this.logger.warn(`获取第${i+1}批数据失败，停止获取`);
            break; // 如果某一批次没有数据，则停止获取
          }
        }
      }
      
      // 按时间排序（从早到晚）
      if (allCandles.length > 0) {
        allCandles.sort((a: any, b: any) => a.timestamp - b.timestamp);
      }
      
      return allCandles;
    } catch (error) {
      this.logger.error(`分批获取K线数据失败: ${error.message}`, error);
      throw error;
    }
  }
}
