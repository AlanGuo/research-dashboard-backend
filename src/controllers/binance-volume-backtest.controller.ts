import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { BinanceVolumeBacktestService } from "../services/binance-volume-backtest.service";
import {
  VolumeBacktestParamsDto,
  VolumeBacktestQueryDto,
  VolumeBacktestResponse,
  SupplementRemovedSymbolsDto,
} from "../dto/volume-backtest-params.dto";

@Controller("/v1/binance/volume-backtest")
export class BinanceVolumeBacktestController {
  private readonly logger = new Logger(BinanceVolumeBacktestController.name);

  constructor(
    private readonly volumeBacktestService: BinanceVolumeBacktestService,
  ) {}

  /**
   * 执行成交量排行榜回测
   * POST /api/binance/volume-backtest
   */
  @Post()
  async executeBacktest(
    @Body() params: VolumeBacktestParamsDto,
  ): Promise<VolumeBacktestResponse> {
    try {
      this.logger.log(`收到回测请求: ${JSON.stringify(params)}`);
      this.logger.log(`📅 回测将使用每周一重新计算的交易对列表`);

      // 验证时间范围
      const startTime = new Date(params.startTime);
      const endTime = new Date(params.endTime);
      const timeDiff = endTime.getTime() - startTime.getTime();
      const maxRecommendedDuration = 7 * 24 * 60 * 60 * 1000; // 推荐最大7天

      if (timeDiff <= 0) {
        throw new HttpException(
          "结束时间必须大于开始时间",
          HttpStatus.BAD_REQUEST,
        );
      }

      // 如果超过推荐时间，添加警告日志
      if (timeDiff > maxRecommendedDuration) {
        const durationDays = Math.ceil(timeDiff / (24 * 60 * 60 * 1000));
        const weekCount = Math.ceil(durationDays / 7);
        this.logger.warn(
          `⚠️ 回测时间范围较长 (${durationDays} 天, 跨越 ${weekCount} 周)，可能需要较长处理时间和更多API调用`,
        );
        this.logger.warn(
          `   建议分批执行或使用更大的granularityHours来减少计算量`,
        );
        this.logger.warn(`   系统将为每周单独计算符合条件的交易对列表`);
      }

      const result =
        await this.volumeBacktestService.executeVolumeBacktest(params);
      return result;
    } catch (error) {
      this.logger.error("执行回测失败:", error);
      throw new HttpException(
        error.message || "回测执行失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 查询历史回测数据
   * GET /api/binance/volume-backtest
   */
  @Get()
  async getBacktestData(@Query() query: VolumeBacktestQueryDto) {
    try {
      let startTime: Date | undefined;
      let endTime: Date | undefined;

      if (query.startTime) {
        startTime = new Date(query.startTime);
      }

      if (query.endTime) {
        endTime = new Date(query.endTime);
      }

      // 验证时间范围
      if (startTime && endTime && startTime >= endTime) {
        throw new HttpException(
          "结束时间必须大于开始时间",
          HttpStatus.BAD_REQUEST,
        );
      }

      const results = await this.volumeBacktestService.getBacktestResults(
        startTime,
        endTime,
      );

      // 从结果数据中计算 granularityHours
      let granularityHours = 8; // 默认值
      if (results.length >= 2) {
        // 计算前两个结果的时间间隔（毫秒）
        const timeDiff = results[1].timestamp.getTime() - results[0].timestamp.getTime();
        // 转换为小时
        granularityHours = Math.round(timeDiff / (1000 * 60 * 60));
      }

      return {
        success: true,
        granularityHours, // 从数据中计算得出的回测时间粒度
        data: results.map((result) => ({
          timestamp: result.timestamp.toISOString(),
          hour: result.hour,
          btcPrice: result.btcPrice,
          btcPriceChange24h: result.btcPriceChange24h,
          rankings: result.rankings,
          removedSymbols: result.removedSymbols || [], // 从上一期排名中移除的交易对
          marketStats: {
            totalVolume: result.totalMarketVolume,
            totalQuoteVolume: result.totalMarketQuoteVolume,
          },
          // calculationTime: result.calculationDuration,
        })),
        meta: {
          count: results.length,
          dateRange: {
            start: startTime?.toISOString(),
            end: endTime?.toISOString(),
          },
        },
      };
    } catch (error) {
      this.logger.error("查询回测数据失败:", error);
      throw new HttpException(
        error.message || "查询失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取回测任务状态
   * GET /api/binance/volume-backtest/status
   */
  @Get("status")
  async getBacktestStatus() {
    // TODO: 实现异步任务状态查询
    return {
      success: true,
      message: "回测功能当前为同步执行模式",
    };
  }

  /**
   * 补充现有回测数据的removedSymbols字段
   * POST /api/binance/volume-backtest/supplement-removed-symbols
   */
  @Post("supplement-removed-symbols")
  async supplementRemovedSymbols(
    @Body() params: SupplementRemovedSymbolsDto
  ) {
    try {
      this.logger.log(`收到补充removedSymbols请求: ${JSON.stringify(params)}`);

      const startTime = new Date(params.startTime);
      const endTime = new Date(params.endTime);

      // 验证时间范围
      if (startTime >= endTime) {
        throw new HttpException(
          "结束时间必须大于开始时间",
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.volumeBacktestService.supplementRemovedSymbols(
        startTime,
        endTime,
        params.granularityHours || 8,
      );

      return result;
    } catch (error) {
      this.logger.error("补充removedSymbols失败:", error);
      throw new HttpException(
        error.message || "补充removedSymbols失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 清理过期缓存
   * POST /v1/binance/volume-backtest/cache-cleanup
   */
  @Post("cache-cleanup")
  async cleanupCache(@Body() params: { olderThanDays?: number }) {
    try {
      await this.volumeBacktestService.cleanupFilterCache(params.olderThanDays);
      return {
        success: true,
        message: "缓存清理完成",
      };
    } catch (error) {
      this.logger.error("清理缓存失败:", error);
      throw new HttpException(
        error.message || "清理缓存失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
