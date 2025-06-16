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

      if (query.date) {
        // 查询特定日期的数据
        startTime = new Date(query.date);
        endTime = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
      }

      if (query.hour !== undefined) {
        // 查询特定小时的数据
        if (!startTime) {
          throw new HttpException(
            "查询特定小时需要提供日期参数",
            HttpStatus.BAD_REQUEST,
          );
        }
        startTime.setHours(query.hour, 0, 0, 0);
        endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      }

      const results = await this.volumeBacktestService.getBacktestResults(
        startTime,
        endTime,
        query.symbol,
      );

      return {
        success: true,
        data: results.map((result) => ({
          timestamp: result.timestamp.toISOString(),
          hour: result.hour,
          volumeRankings: query.limit
            ? result.volumeRankings.slice(0, query.limit)
            : result.volumeRankings,
          priceChangeRankings: query.limit
            ? result.priceChangeRankings.slice(0, query.limit)
            : result.priceChangeRankings,
          volatilityRankings: query.limit
            ? result.volatilityRankings.slice(0, query.limit)
            : result.volatilityRankings,
          marketStats: {
            totalVolume: result.totalMarketVolume,
            totalQuoteVolume: result.totalMarketQuoteVolume,
            activePairs: result.activePairs,
          },
          calculationTime: result.calculationDuration,
        })),
        meta: {
          count: results.length,
          symbol: query.symbol,
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
