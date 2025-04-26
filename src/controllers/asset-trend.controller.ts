import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import { AssetTrendService } from '../services/asset-trend.service';
import { AssetTrendResponse } from '../models/asset-trend.model';

@Controller('v1/asset-trend')
export class AssetTrendController {
  private readonly logger = new Logger(AssetTrendController.name);
  constructor(private readonly assetTrendService: AssetTrendService) {}

  /**
   * 获取所有资产在各趋势期间的表现数据
   */
  @Get()
  public async getAllAssetTrends(
    @Query('forceUpdate') forceUpdate?: string
  ): Promise<AssetTrendResponse> {
    try {
      // 检查是否需要强制更新
      const shouldForceUpdate = forceUpdate === 'true';
      
      // 尝试从数据库获取数据
      let trends = await this.assetTrendService.getAllAssetTrends();
      
      // 如果数据库中没有数据或需要强制更新，则计算并存储
      if (trends.length === 0 || shouldForceUpdate) {
        this.logger.log('数据库中没有资产趋势表现数据或需要强制更新，开始计算...');
        trends = await this.assetTrendService.calculateAndStoreAllAssetTrends(shouldForceUpdate);
      }
      
      return {
        success: true,
        data: trends,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('获取资产趋势表现数据失败', error);
      return {
        success: false,
        data: [],
        timestamp: new Date().toISOString(),
        message: '获取资产趋势表现数据失败'
      };
    }
  };

  /**
   * 获取单个资产在各趋势期间的表现数据
   */
  @Get(':assetId')
  public async getAssetTrend(
    @Param('assetId') assetId: string,
    @Query('forceUpdate') forceUpdate?: string
  ): Promise<AssetTrendResponse> {
    try {
      // 检查是否需要强制更新
      const shouldForceUpdate = forceUpdate === 'true';
      
      // 尝试从数据库获取数据
      let trend = await this.assetTrendService.getAssetTrend(assetId);
      
      // 如果数据库中没有数据或需要强制更新，则计算并存储所有资产数据
      if (!trend || shouldForceUpdate) {
        this.logger.log(`数据库中没有资产 ${assetId} 的趋势表现数据或需要强制更新，开始计算...`);
        const trends = await this.assetTrendService.calculateAndStoreAllAssetTrends(shouldForceUpdate);
        trend = trends.find(p => p.assetId === assetId) || null;
      }
      
      if (trend) {
        return {
          success: true,
          data: trend,
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          success: false,
          data: [],
          timestamp: new Date().toISOString(),
          message: `未找到资产 ${assetId} 的趋势表现数据`
        };
      }
    } catch (error) {
      this.logger.error('获取资产趋势表现数据失败', error);
      return {
        success: false,
        data: [],
        timestamp: new Date().toISOString(),
        message: '获取资产趋势表现数据失败'
      };
    }
  };

  /**
   * 强制重新计算并存储所有资产在各趋势期间的表现
   */
  @Get('recalculate/all')
  public async recalculateAllAssetTrends(): Promise<AssetTrendResponse> {
    try {
      this.logger.log('开始重新计算所有资产的趋势表现数据...');
      const trends = await this.assetTrendService.calculateAndStoreAllAssetTrends(true);
      
      return {
        success: true,
        data: trends,
        timestamp: new Date().toISOString(),
        message: '已重新计算并存储所有资产的趋势表现数据'
      };
    } catch (error) {
      this.logger.error('重新计算资产趋势表现数据失败', error);
      return {
        success: false,
        data: [],
        timestamp: new Date().toISOString(),
        message: '重新计算资产趋势表现数据失败'
      };
    }
  };
}
