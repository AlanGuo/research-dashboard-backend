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
          rankings: query.limit
            ? result.rankings.slice(0, query.limit)
            : result.rankings,
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
   * 测试币安API连通性
   * GET /api/binance/volume-backtest/test-connection
   */
  @Get("test-connection")
  async testBinanceConnection() {
    try {
      this.logger.log("测试Binance API连通性...");

      const result = await this.volumeBacktestService.testBinanceApi();

      return {
        success: true,
        message: "Binance API连通测试成功",
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error("Binance API连通测试失败:", error);
      throw new HttpException(
        {
          success: false,
          message: "Binance API连通测试失败",
          error: error.message || "未知错误",
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * 获取支持的交易对列表
   * GET /api/binance/volume-backtest/symbols
   */
  @Get("symbols")
  async getSupportedSymbols(@Query("quoteAsset") quoteAsset: string = "USDT") {
    try {
      // 这里可以调用币安API获取最新的交易对列表
      // 为了演示，返回一些常见的交易对
      const commonSymbols = [
        "BTCUSDT",
        "ETHUSDT",
        "BNBUSDT",
        "ADAUSDT",
        "XRPUSDT",
        "SOLUSDT",
        "DOTUSDT",
        "DOGEUSDT",
        "AVAXUSDT",
        "SHIBUSDT",
        "MATICUSDT",
        "LTCUSDT",
        "TRXUSDT",
        "LINKUSDT",
        "ATOMUSDT",
        "ETCUSDT",
        "XLMUSDT",
        "BCHUSDT",
        "FILUSDT",
        "VETUSDT",
      ];

      return {
        success: true,
        data: {
          quoteAsset,
          symbols: commonSymbols,
          count: commonSymbols.length,
        },
      };
    } catch (error) {
      this.logger.error("获取交易对列表失败:", error);
      throw new HttpException(
        "获取交易对列表失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 测试期货API连通性
   * GET /v1/binance/volume-backtest/test-futures-api
   */
  @Get("test-futures-api")
  async testFuturesApi() {
    try {
      this.logger.log("测试期货API连通性请求");
      const result = await this.volumeBacktestService.testFuturesApi();
      return result;
    } catch (error) {
      this.logger.error("期货API测试失败:", error);
      throw new HttpException(
        error.message || "期货API测试失败",
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取筛选缓存统计信息
   * GET /v1/binance/volume-backtest/cache-stats
   */
  @Get("cache-stats")
  async getCacheStats() {
    try {
      const stats = await this.volumeBacktestService.getFilterCacheStats();
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      this.logger.error("获取缓存统计失败:", error);
      throw new HttpException(
        error.message || "获取缓存统计失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
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
   * 测试并发筛选交易对
   * POST /api/binance/volume-backtest/filter-concurrent
   */
  @Post("filter-concurrent")
  async testConcurrentFilter(
    @Body()
    body: {
      quoteAsset?: string;
      minHistoryDays?: number;
      requireFutures?: boolean;
      excludeStablecoins?: boolean;
      concurrency?: number;
      symbols?: string[];
    },
  ) {
    try {
      this.logger.log(`收到并发筛选测试请求: ${JSON.stringify(body)}`);

      // 获取要测试的交易对列表
      let symbolsToTest: string[] = [];

      if (body.symbols && body.symbols.length > 0) {
        // 使用指定的交易对
        symbolsToTest = body.symbols;
      } else {
        // 获取所有USDT交易对进行测试
        try {
          const binanceService = this.volumeBacktestService["binanceService"];
          const exchangeInfo = await binanceService.getExchangeInfo();
          symbolsToTest = exchangeInfo.symbols
            .filter(
              (symbol) =>
                symbol.status === "TRADING" &&
                symbol.quoteAsset === (body.quoteAsset || "USDT") &&
                !symbol.symbol.includes("UP") &&
                !symbol.symbol.includes("DOWN") &&
                !symbol.symbol.includes("BULL") &&
                !symbol.symbol.includes("BEAR"),
            )
            .map((symbol) => symbol.symbol)
            .slice(0, 50); // 限制为前50个交易对进行测试
        } catch (error) {
          throw new HttpException(
            `获取交易对列表失败: ${error.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }

      this.logger.log(`🔍 将测试 ${symbolsToTest.length} 个交易对的并发筛选`);

      // 执行并发筛选
      const result = await this.volumeBacktestService.filterSymbolsConcurrently(
        symbolsToTest,
        {
          minHistoryDays: body.minHistoryDays || 365,
          requireFutures: body.requireFutures || false,
          excludeStablecoins: body.excludeStablecoins ?? true,
          concurrency: body.concurrency || 5,
          referenceTime: new Date(),
        },
      );

      // 分析结果
      const analysis = {
        totalSymbols: symbolsToTest.length,
        validSymbols: result.valid.length,
        invalidSymbols: result.invalid.length,
        validRate:
          ((result.valid.length / symbolsToTest.length) * 100).toFixed(1) + "%",
        processingStats: result.stats,
        sampleValidSymbols: result.valid.slice(0, 10),
        invalidReasonsSummary: this.summarizeInvalidReasons(
          result.invalidReasons,
        ),
      };

      this.logger.log(
        `✅ 并发筛选测试完成: ${result.valid.length}/${symbolsToTest.length} 个交易对有效`,
      );

      return {
        success: true,
        message: "并发筛选测试完成",
        data: {
          validSymbols: result.valid,
          invalidSymbols: result.invalid,
          invalidReasons: result.invalidReasons,
          analysis,
        },
      };
    } catch (error) {
      this.logger.error(`并发筛选测试失败: ${error.message}`, error.stack);
      throw new HttpException(
        `并发筛选测试失败: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 汇总失败原因统计
   */
  private summarizeInvalidReasons(invalidReasons: {
    [symbol: string]: string[];
  }): { [reason: string]: number } {
    const summary: { [reason: string]: number } = {};

    Object.values(invalidReasons).forEach((reasons) => {
      reasons.forEach((reason) => {
        summary[reason] = (summary[reason] || 0) + 1;
      });
    });

    return summary;
  }
}
