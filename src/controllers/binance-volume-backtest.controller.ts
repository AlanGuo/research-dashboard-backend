import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  Param,
  Delete,
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

      // 验证时间范围
      const startTime = new Date(params.startTime);
      const endTime = new Date(params.endTime);
      params.granularityHours = params.granularityHours || 8; // 默认8小时粒度
      const timeDiff = endTime.getTime() - startTime.getTime();

      if (timeDiff <= 0) {
        throw new HttpException(
          "结束时间必须大于开始时间",
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`使用回测参数: ${JSON.stringify(params)}`);
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
        const timeDiff =
          results[1].timestamp.getTime() - results[0].timestamp.getTime();
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
          btcdomPrice: result.btcdomPrice,
          btcdomPriceChange24h: result.btcdomPriceChange24h,
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

  /**
   * 补充现有数据的BTCDOM价格
   * POST /v1/binance/volume-backtest/supplement-btcdom-prices
   */
  @Post("supplement-btcdom-prices")
  async supplementBtcdomPrices(
    @Body() params: {
      startTime?: string;
      endTime?: string;
    }
  ) {
    try {
      this.logger.log(`收到补充BTCDOM价格请求: ${JSON.stringify(params)}`);

      let startTime: Date | undefined;
      let endTime: Date | undefined;

      if (params.startTime) {
        startTime = new Date(params.startTime);
      }

      if (params.endTime) {
        endTime = new Date(params.endTime);
      }

      // 验证时间范围
      if (startTime && endTime && startTime >= endTime) {
        throw new HttpException(
          "结束时间必须大于开始时间",
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.volumeBacktestService.supplementBtcdomPrices(
        startTime,
        endTime,
      );

      return result;
    } catch (error) {
      this.logger.error("补充BTCDOM价格失败:", error);
      throw new HttpException(
        error.message || "补充BTCDOM价格失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 启动异步回测
   * POST /v1/binance/volume-backtest/async
   */
  @Post("async")
  async startAsyncBacktest(@Body() params: VolumeBacktestParamsDto) {
    try {
      this.logger.log(`收到异步回测请求: ${JSON.stringify(params)}`);

      // 验证时间范围
      const startTime = new Date(params.startTime);
      const endTime = new Date(params.endTime);
      const timeDiff = endTime.getTime() - startTime.getTime();

      if (timeDiff <= 0) {
        throw new HttpException(
          "结束时间必须大于开始时间",
          HttpStatus.BAD_REQUEST,
        );
      }

      const result =
        await this.volumeBacktestService.startAsyncVolumeBacktest(params);
      return result;
    } catch (error) {
      this.logger.error("启动异步回测失败:", error);
      throw new HttpException(
        error.message || "启动异步回测失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 查询异步回测进度
   * GET /v1/binance/volume-backtest/async/:taskId/progress
   */
  @Get("async/:taskId/progress")
  async getAsyncBacktestProgress(@Param("taskId") taskId: string) {
    try {
      const progress =
        await this.volumeBacktestService.getAsyncBacktestProgress(taskId);
      return progress;
    } catch (error) {
      this.logger.error(`查询任务 ${taskId} 进度失败:`, error);
      throw new HttpException(
        error.message || "查询进度失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }



  /**
   * 取消异步回测
   * DELETE /v1/binance/volume-backtest/async/:taskId
   */
  @Delete("async/:taskId")
  async cancelAsyncBacktest(@Param("taskId") taskId: string) {
    try {
      const result =
        await this.volumeBacktestService.cancelAsyncBacktest(taskId);
      return result;
    } catch (error) {
      this.logger.error(`取消任务 ${taskId} 失败:`, error);
      throw new HttpException(
        error.message || "取消任务失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取异步回测任务列表
   * GET /v1/binance/volume-backtest/async/tasks
   */
  @Get("async/tasks")
  async getAsyncBacktestTasks(
    @Query("limit") limit?: number,
    @Query("offset") offset?: number,
  ) {
    try {
      const tasks = await this.volumeBacktestService.getAsyncBacktestTasks(
        limit || 20,
        offset || 0,
      );
      return tasks;
    } catch (error) {
      this.logger.error("获取任务列表失败:", error);
      throw new HttpException(
        error.message || "获取任务列表失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 恢复中断的异步回测任务
   * POST /v1/binance/volume-backtest/async/:taskId/resume
   */
  @Post("async/:taskId/resume")
  async resumeInterruptedTask(@Param("taskId") taskId: string) {
    try {
      const result =
        await this.volumeBacktestService.resumeInterruptedTask(taskId);
      return result;
    } catch (error) {
      this.logger.error(`恢复任务 ${taskId} 失败:`, error);
      throw new HttpException(
        error.message || "恢复任务失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 清理中断的异步回测任务
   * POST /v1/binance/volume-backtest/async/:taskId/cleanup
   */
  @Post("async/:taskId/cleanup")
  async cleanupInterruptedTask(@Param("taskId") taskId: string) {
    try {
      const result =
        await this.volumeBacktestService.cleanupInterruptedTask(taskId);
      return result;
    } catch (error) {
      this.logger.error(`清理任务 ${taskId} 失败:`, error);
      throw new HttpException(
        error.message || "清理任务失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取所有中断的任务
   * GET /v1/binance/volume-backtest/async/interrupted
   */
  @Get("async/interrupted")
  async getInterruptedTasks() {
    try {
      const tasks = await this.volumeBacktestService.getInterruptedTasks();
      return tasks;
    } catch (error) {
      this.logger.error("获取中断任务列表失败:", error);
      throw new HttpException(
        error.message || "获取中断任务列表失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 批量清理所有中断的任务
   * POST /v1/binance/volume-backtest/async/cleanup-all
   */
  @Post("async/cleanup-all")
  async cleanupAllInterruptedTasks() {
    try {
      const result =
        await this.volumeBacktestService.cleanupAllInterruptedTasks();
      return result;
    } catch (error) {
      this.logger.error("批量清理中断任务失败:", error);
      throw new HttpException(
        error.message || "批量清理失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 补充往期缺失的currentFundingRate字段
   * POST /v1/binance/volume-backtest/backfill-current-funding-rate
   */
  @Post("backfill-current-funding-rate")
  async backfillCurrentFundingRate(
    @Body() params: { startTime?: string; endTime?: string; },
  ) {
    try {
      this.logger.log(`开始补充currentFundingRate: ${JSON.stringify(params)}`);

      let startTime: Date | undefined;
      let endTime: Date | undefined;

      if (params.startTime) {
        startTime = new Date(params.startTime);
      }

      if (params.endTime) {
        endTime = new Date(params.endTime);
      }

      // 验证时间范围
      if (startTime && endTime && startTime >= endTime) {
        throw new HttpException(
          "结束时间必须大于开始时间",
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.volumeBacktestService.backfillCurrentFundingRate(
        startTime,
        endTime
      );

      return result;
    } catch (error) {
      this.logger.error("补充currentFundingRate失败:", error);
      throw new HttpException(
        error.message || "补充currentFundingRate失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 异步补充往期缺失的currentFundingRate字段
   * POST /v1/binance/volume-backtest/backfill-current-funding-rate-async
   */
  @Post("backfill-current-funding-rate-async")
  async backfillCurrentFundingRateAsync(
    @Body() params: { startTime?: string; endTime?: string; batchSize?: number },
  ) {
    try {
      this.logger.log(`开始异步补充currentFundingRate: ${JSON.stringify(params)}`);

      let startTime: Date | undefined;
      let endTime: Date | undefined;

      if (params.startTime) {
        startTime = new Date(params.startTime);
      }

      if (params.endTime) {
        endTime = new Date(params.endTime);
      }

      // 验证时间范围
      if (startTime && endTime && startTime >= endTime) {
        throw new HttpException(
          "结束时间必须大于开始时间",
          HttpStatus.BAD_REQUEST,
        );
      }

      // 启动异步任务
      const taskId = this.volumeBacktestService.startAsyncBackfillCurrentFundingRate(
        startTime,
        endTime,
        params.batchSize || 50
      );

      return {
        success: true,
        taskId,
        message: "异步补充任务已启动",
      };
    } catch (error) {
      this.logger.error("启动异步补充currentFundingRate失败:", error);
      throw new HttpException(
        error.message || "启动异步补充失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
