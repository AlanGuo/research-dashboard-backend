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
    @Query('forceUpdate') forceUpdate?: string,
    @Query('trendType') trendType: 'centralBank' | 'm2' = 'centralBank'
  ): Promise<AssetTrendResponse> {
    try {
      // 检查是否需要强制更新
      const shouldForceUpdate = forceUpdate === 'true';
      
      // 尝试从数据库获取数据
      let trends = await this.assetTrendService.getAllAssetTrends(trendType);
      
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
    @Query('forceUpdate') forceUpdate?: string,
    @Query('trendType') trendType: 'centralBank' | 'm2' = 'centralBank'
  ): Promise<AssetTrendResponse> {
    try {
      // 检查是否需要强制更新
      const shouldForceUpdate = forceUpdate === 'true';
      
      // 尝试从数据库获取数据
      let trend = await this.assetTrendService.getAssetTrend(assetId, trendType);
      
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
  
  /**
   * 临时计算资产在特定滞后天数下的趋势表现，不更新数据库
   * @param assetId 资产ID
   * @param query 查询参数，包含intervalType、intervalCount和trendType
   */
  @Get(':assetId/lag-days')
  public async updateAssetLagDays(
    @Param('assetId') assetId: string,
    @Query() query: { intervalType: string; intervalCount: number; trendType?: 'centralBank' | 'm2' }
  ): Promise<AssetTrendResponse> {
    try {
      const trendType = query.trendType || 'centralBank';
      this.logger.log(`开始临时计算资产 ${assetId} 在特定滞后天数下的${trendType}趋势表现，间隔类型: ${query.intervalType}, 间隔数量: ${query.intervalCount}`);
      
      const tempTrend = await this.assetTrendService.updateAssetLagDays(
        assetId,
        query.intervalType,
        query.intervalCount,
        trendType as 'centralBank' | 'm2'
      );
      
      if (tempTrend) {
        // 计算滞后天数
        let lagDays = 0;
        switch (query.intervalType) {
          case '1D': lagDays = query.intervalCount; break;
          case '1W': lagDays = query.intervalCount * 7; break;
          case '1M': lagDays = query.intervalCount * 30; break;
          default: lagDays = query.intervalCount;
        }
        
        return {
          success: true,
          data: tempTrend,
          timestamp: new Date().toISOString(),
          message: `已临时计算资产 ${assetId} 在 ${lagDays} 天滞后下的${trendType}趋势表现`,
          temporary: true,
          trendType: trendType
        };
      } else {
        return {
          success: false,
          data: [],
          timestamp: new Date().toISOString(),
          message: `未找到资产 ${assetId}`
        };
      }
    } catch (error) {
      this.logger.error(`计算资产 ${assetId} 在特定滞后天数下的趋势表现失败`, error);
      return {
        success: false,
        data: [],
        timestamp: new Date().toISOString(),
        message: `计算资产 ${assetId} 在特定滞后天数下的趋势表现失败: ${error.message}`
      };
    }
  }
}
