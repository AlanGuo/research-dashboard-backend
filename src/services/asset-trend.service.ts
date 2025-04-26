import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AssetTrend, AssetPerformance } from '../models/asset-trend.model';
import { GliTrendPeriod } from '../models/gli-trend.model';
import { TradingViewService } from './tradingview.service';
import { BenchmarkService } from './benchmark.service';
import { GliService } from './gli.service';

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
      // 获取所有趋势期间
      const trendPeriods = await this.getTrendPeriods();
      
      // 获取所有对比标的
      const assets = await this.getBenchmarkAssets();
      
      // 计算每个资产在每个趋势期间的表现
      const results: AssetTrend[] = [];
      
      for (const asset of assets) {
        // 检查数据库中是否已有该资产的数据，且不需要强制更新
        if (!forceUpdate) {
          const existingData = await this.assetTrendModel.findOne({ assetId: asset.id });
          if (existingData) {
            results.push(existingData);
            continue;
          }
        }
        
        // 计算该资产在各趋势期间的表现
        const assetTrend = await this.calculateAssetTrend(asset, trendPeriods);
        
        // 存储到数据库
        const upsertResult = await this.assetTrendModel.findOneAndUpdate(
          { assetId: asset.id },
          assetTrend,
          { upsert: true, new: true }
        );
        
        results.push(upsertResult);
      }
      
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
      const performances: AssetPerformance[] = [];
      
      for (const period of trendPeriods) {
        try {
          // 构建趋势期间ID
          const periodId = `${period.startDate}_${period.endDate}`;
          
          // 获取该时期的资产数据
          const startDate = new Date(period.startDate).getTime();
          const endDate = new Date(period.endDate).getTime();
          
          // 构建查询参数
          const params = {
            from: startDate.toString(),
            to: endDate.toString(),
            interval: '1D' // 使用日线数据计算涨跌幅
          };
          
          // 直接使用 TradingViewService 获取 K 线数据
          const klineData = await this.tradingViewService.getKlineData(
            asset.id,
            params.interval,
            undefined,
            Math.floor(endDate / 1000) // 转换为秒级时间戳
          );
          
          if (klineData) {
            let candles = [];
            
            // 处理不同的数据格式
            if (klineData.candles && Array.isArray(klineData.candles)) {
              candles = klineData.candles;
            }
            
            // 如果有数据，计算涨跌幅
            if (candles.length > 0) {
              // 按时间排序
              candles.sort((a: any, b: any) => a.timestamp - b.timestamp);
              
              const startPrice = candles[0].close;
              const endPrice = candles[candles.length - 1].close;
              const change = ((endPrice - startPrice) / startPrice) * 100;
              
              performances.push({
                periodId,
                startDate: period.startDate,
                endDate: period.endDate,
                trend: period.trend,
                change,
                startPrice,
                endPrice
              });
            } else {
              // 如果没有数据，添加空记录
              performances.push({
                periodId,
                startDate: period.startDate,
                endDate: period.endDate,
                trend: period.trend,
                change: 0
              });
            }
          }
        } catch (err) {
          this.logger.error(`计算资产 ${asset.name} 在趋势期间 ${period.startDate}-${period.endDate} 的表现失败`, err);
          // 添加空记录
          performances.push({
            periodId: `${period.startDate}_${period.endDate}`,
            startDate: period.startDate,
            endDate: period.endDate,
            trend: period.trend,
            change: 0
          });
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
}
