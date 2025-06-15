import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { createHash } from "crypto";
import {
  VolumeBacktest,
  VolumeBacktestDocument,
  HourlyVolumeRankingItem,
} from "../models/volume-backtest.model";
import {
  SymbolFilterCache,
  SymbolFilterCacheDocument,
} from "../models/symbol-filter-cache.model";
import {
  VolumeBacktestParamsDto,
  VolumeBacktestResponse,
} from "../dto/volume-backtest-params.dto";
import { ConfigService } from "../config/config.service";
import { BinanceService } from "./binance.service";


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
    "USDT",
    "USDC",
    "BUSD",
    "DAI",
    "TUSD",
    "USDP",
    "USDD",
    "FRAX",
    "FDUSD",
    "PYUSD",
    "LUSD",
    "GUSD",
    "SUSD",
    "HUSD",
    "OUSD",
    "USDK",
    "USDN",
    "UST",
    "USTC",
    "CUSD",
    "DOLA",
    "USDX",
    "RSR",
    "TRIBE",
  ];

  constructor(
    @InjectModel(VolumeBacktest.name)
    private volumeBacktestModel: Model<VolumeBacktestDocument>,
    @InjectModel(SymbolFilterCache.name)
    private symbolFilterCacheModel: Model<SymbolFilterCacheDocument>,
    private readonly configService: ConfigService,
    private readonly binanceService: BinanceService,
  ) {}

  /**
   * 执行成交量排行榜回测
   */
  async executeVolumeBacktest(
    params: VolumeBacktestParamsDto,
  ): Promise<VolumeBacktestResponse> {
    const startTime = new Date(params.startTime);
    const endTime = new Date(params.endTime);
    const startExecution = Date.now();

    this.logger.log(
      `开始执行成交量回测: ${startTime.toISOString()} - ${endTime.toISOString()}`,
    );

    try {
      // 1. 获取回测期间涉及的所有周一时间点
      const weeklyCalculationTimes = this.getWeeklySymbolCalculationTimes(
        startTime,
        endTime,
      );
      this.logger.log(
        `📅 回测期间涉及 ${weeklyCalculationTimes.length} 个周一时间点`,
      );

      // 2. 获取活跃交易对列表（用于所有周的计算）
      const allActiveSymbols = await this.getActiveSymbols(params);
      this.logger.log(`🔍 获取到 ${allActiveSymbols.length} 个活跃交易对`);

      // 3. 为每个周一时间点计算或获取缓存的符合条件的symbols
      const weeklySymbolsMap = new Map<string, string[]>();
      let totalValidSymbols = 0;
      let totalInvalidSymbols = 0;
      const symbolStats: any = {
        totalDiscovered: allActiveSymbols.length,
        weeklyBreakdown: [],
        filterCriteria: {
          minHistoryDays: params.minHistoryDays || 365,
          requireFutures: params.requireFutures || false,
          excludeStablecoins: params.excludeStablecoins ?? true,
        },
      };

      for (const weekStart of weeklyCalculationTimes) {
        // 生成该周的筛选条件哈希
        const weeklyFilterHash = this.generateFilterHash(weekStart, params);
        this.logger.log(
          `🔑 周一 ${weekStart.toISOString().slice(0, 10)} 筛选条件哈希: ${weeklyFilterHash.slice(0, 8)}...`,
        );

        let symbolFilter = await this.getFilterFromCache(weeklyFilterHash);

        if (!symbolFilter) {
          // 缓存未命中，使用并发筛选
          this.logger.log(
            `💾 周一 ${weekStart.toISOString().slice(0, 10)} 缓存未命中，启动并发筛选 (${params.concurrency || 5} 并发)...`,
          );
          const concurrentResult = await this.filterSymbolsConcurrently(
            allActiveSymbols,
            {
              minHistoryDays: params.minHistoryDays || 365,
              requireFutures: params.requireFutures || false,
              excludeStablecoins: params.excludeStablecoins ?? true,
              concurrency: params.concurrency || 5,
              referenceTime: weekStart,
            },
          );

          symbolFilter = {
            valid: concurrentResult.valid,
            invalid: concurrentResult.invalid,
            invalidReasons: concurrentResult.invalidReasons,
          };

          // 保存到缓存
          await this.saveFilterToCache(
            weeklyFilterHash,
            weekStart,
            params,
            symbolFilter,
            allActiveSymbols,
            concurrentResult.stats.processingTime,
          );
        } else {
          this.logger.log(
            `✅ 周一 ${weekStart.toISOString().slice(0, 10)} 使用缓存: ${symbolFilter.valid.length} 个有效交易对`,
          );
        }

        const weekKey = weekStart.toISOString().slice(0, 10);
        weeklySymbolsMap.set(weekKey, symbolFilter.valid);

        totalValidSymbols += symbolFilter.valid.length;
        totalInvalidSymbols += symbolFilter.invalid.length;

        // 添加周统计信息
        symbolStats.weeklyBreakdown.push({
          weekStart: weekKey,
          validSymbols: symbolFilter.valid.length,
          invalidSymbols: symbolFilter.invalid.length,
          validRate: `${(
            (symbolFilter.valid.length / allActiveSymbols.length) *
            100
          ).toFixed(1)}%`,
          sampleSymbols: symbolFilter.valid.slice(0, 5), // 减少样例数量
        });
      }

      // 4. 检查是否有任何符合条件的交易对
      if (totalValidSymbols === 0) {
        throw new Error("没有找到符合条件的交易对，请检查时间范围和参数设置");
      }

      this.logger.log(
        `✅ 所有周筛选完成: 平均 ${Math.round(totalValidSymbols / weeklyCalculationTimes.length)} 个交易对/周`,
      );

      // 5. 计算需要处理的小时数
      const totalHours = Math.ceil(
        (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60),
      );
      this.logger.log(
        `📊 开始处理 ${totalHours} 小时数据，使用并发筛选的交易对列表`,
      );

      // 6. 执行回测计算（使用周期性symbols）
      await this.calculateHourlyRankingsWithWeeklySymbols(
        weeklySymbolsMap,
        startTime,
        endTime,
        params,
      );

      const processingTime = Date.now() - startExecution;
      this.logger.log(
        `🎉 回测完成! 总耗时: ${processingTime}ms (${(processingTime / 1000).toFixed(1)}s)`,
      );

      // 查询并返回保存的结果
      const results = await this.getBacktestResults(startTime, endTime);

      // 计算综合统计信息
      symbolStats.validSymbols = Math.round(
        totalValidSymbols / weeklyCalculationTimes.length,
      );
      symbolStats.invalidSymbols = Math.round(
        totalInvalidSymbols / weeklyCalculationTimes.length,
      );
      symbolStats.validRate =
        ((symbolStats.validSymbols / allActiveSymbols.length) * 100).toFixed(
          1,
        ) + "%";

      return {
        success: true,
        data: results.map((result) => ({
          timestamp: result.timestamp.toISOString(),
          hour: result.hour,
          rankings: result.rankings,
          marketStats: {
            totalVolume: result.totalMarketVolume,
            totalQuoteVolume: result.totalMarketQuoteVolume,
            activePairs: result.activePairs,
            topMarketConcentration: this.calculateMarketConcentration(
              result.rankings,
            ),
          },
          calculationTime: result.calculationDuration,
        })),
        meta: {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          totalHours,
          dataPoints: results.length,
          processingTime,
          symbolStats,
          weeklyCalculations: weeklyCalculationTimes.length,
        },
      };
    } catch (error) {
      this.logger.error("回测执行失败:", error);
      throw error;
    }
  }

  /**
   * 获取活跃交易对列表
   */
  private async getActiveSymbols(
    params: VolumeBacktestParamsDto,
  ): Promise<string[]> {
    try {
      const exchangeInfo = await this.binanceService.getExchangeInfo();
      const symbols = exchangeInfo.symbols
        .filter(
          (symbol) =>
            symbol.status === "TRADING" &&
            symbol.quoteAsset === (params.quoteAsset || "USDT") &&
            !symbol.symbol.includes("UP") &&
            !symbol.symbol.includes("DOWN") &&
            !symbol.symbol.includes("BULL") &&
            !symbol.symbol.includes("BEAR"),
        )
        .map((symbol) => symbol.symbol);

      // 如果指定了特定交易对，则使用指定的
      if (params.symbols && params.symbols.length > 0) {
        return params.symbols.filter((symbol) => symbols.includes(symbol));
      }

      return symbols;
    } catch (error) {
      this.logger.error("获取交易对信息失败:", error);
      throw error;
    }
  }



  /**
   * 计算预估完成时间
   */
  private calculateETA(
    periodTimes: number[],
    remainingPeriods: number,
  ): string {
    if (periodTimes.length === 0) return "未知";

    const recentTimes = periodTimes.slice(-5); // 使用最近5次的平均时间
    const avgTime = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;
    const etaMs = avgTime * remainingPeriods;

    if (etaMs < 60000) {
      return `${Math.round(etaMs / 1000)}秒`;
    } else if (etaMs < 3600000) {
      return `${Math.round(etaMs / 60000)}分钟`;
    } else {
      return `${Math.round(etaMs / 3600000)}小时`;
    }
  }

  /**
   * 记录性能指标
   */
  private logPerformanceMetrics(metrics: any, processedPeriods: number): void {
    const avgDataLoad =
      metrics.dataLoadTimes.length > 0
        ? metrics.dataLoadTimes.reduce((a: number, b: number) => a + b, 0) /
          metrics.dataLoadTimes.length
        : 0;
    const avgCalc =
      metrics.calculationTimes.length > 0
        ? metrics.calculationTimes.reduce((a: number, b: number) => a + b, 0) /
          metrics.calculationTimes.length
        : 0;
    const avgSave =
      metrics.saveTimes.length > 0
        ? metrics.saveTimes.reduce((a: number, b: number) => a + b, 0) /
          metrics.saveTimes.length
        : 0;

    this.logger.log(
      `📊 性能统计(前${processedPeriods}周期): 数据加载${avgDataLoad.toFixed(0)}ms | 计算${avgCalc.toFixed(0)}ms | 保存${avgSave.toFixed(0)}ms`,
    );
  }

  /**
   * 记录最终性能报告
   */
  private logFinalPerformanceReport(
    metrics: any,
    totalPeriods: number,
    totalTime: number,
  ): void {
    const avgPeriodTime =
      metrics.periodTimes.reduce((a: number, b: number) => a + b, 0) /
      metrics.periodTimes.length;
    const avgDataLoad =
      metrics.dataLoadTimes.reduce((a: number, b: number) => a + b, 0) /
      metrics.dataLoadTimes.length;
    const avgCalc =
      metrics.calculationTimes.reduce((a: number, b: number) => a + b, 0) /
      metrics.calculationTimes.length;
    const avgSave =
      metrics.saveTimes.reduce((a: number, b: number) => a + b, 0) /
      metrics.saveTimes.length;

    this.logger.log(`📈 最终性能报告:`);
    this.logger.log(
      `   总周期: ${totalPeriods}, 总耗时: ${(totalTime / 1000).toFixed(1)}s`,
    );
    this.logger.log(
      `   平均每周期: ${avgPeriodTime.toFixed(0)}ms (数据${avgDataLoad.toFixed(0)}ms + 计算${avgCalc.toFixed(0)}ms + 保存${avgSave.toFixed(0)}ms)`,
    );
    this.logger.log(
      `   吞吐量: ${((totalPeriods * 3600) / (totalTime / 1000)).toFixed(1)} 周期/小时`,
    );
  }

  /**
   * 更新滑动窗口数据（优化并发处理版本）
   */
  private async updateVolumeWindowsForPeriod(
    volumeWindows: Map<string, VolumeWindow>,
    currentTime: Date,
    periodHours: number = 8,
  ): Promise<void> {
    // 计算当前周期的时间范围
    const periodStart = currentTime.getTime() - periodHours * 60 * 60 * 1000;
    const periodEnd = currentTime.getTime();
    const window24hStart = currentTime.getTime() - 24 * 60 * 60 * 1000;

    this.logger.log(
      `🔄 开始优化并发更新滑动窗口数据，周期: ${new Date(periodStart).toISOString()} - ${new Date(periodEnd).toISOString()}`,
    );

    const symbols = Array.from(volumeWindows.keys());
    this.logger.log(`📦 需要更新 ${symbols.length} 个交易对的数据`);

    // 使用优化的并发处理池
    const processor = async (symbol: string): Promise<KlineData[] | null> => {
      try {
        return await this.loadSymbolKlines(
          symbol,
          new Date(periodStart),
          new Date(periodEnd),
        );
      } catch (error) {
        throw new Error(`${symbol}: ${error.message}`);
      }
    };

    const { results, errors, stats } = await this.processConcurrentlyWithPool(
      symbols,
      processor,
      {
        initialConcurrency: 8,
        maxConcurrency: 15,
        adaptiveThrottling: true,
        retryFailedItems: true,
        maxRetries: 3,
      },
    );

    // 处理获取结果并更新窗口
    let successCount = 0;
    let failureCount = 0;
    const failedSymbols: string[] = [];
    const successSymbols: string[] = [];

    for (const symbol of symbols) {
      const window = volumeWindows.get(symbol);

      if (results.has(symbol)) {
        const newKlines = results.get(symbol);
        if (window && newKlines && newKlines.length > 0) {
          // 添加新数据
          window.data.push(...newKlines);

          // 移除超过24小时的旧数据
          window.data = window.data.filter(
            (kline) => kline.openTime >= window24hStart,
          );

          // 重新计算24小时成交量
          this.updateWindowVolume(window);
          successCount++;
          successSymbols.push(symbol);
        } else {
          failedSymbols.push(symbol);
          failureCount++;
        }
      } else if (errors.has(symbol)) {
        failedSymbols.push(symbol);
        failureCount++;
      }
    }

    const successRate = ((successCount / symbols.length) * 100).toFixed(1);
    this.logger.log(
      `📊 优化滑动窗口更新完成: 成功 ${successCount}/${symbols.length} (${successRate}%), 失败 ${failureCount}`,
    );
    this.logger.log(
      `   处理统计: 耗时 ${stats.totalTime}ms, 平均响应 ${stats.avgResponseTime.toFixed(0)}ms, 并发调整 ${stats.concurrencyAdjustments} 次`,
    );

    // 显示成功的币种详情（限制数量）
    if (successSymbols.length > 0) {
      this.logger.debug(
        `✅ 成功更新的币种: ${successSymbols.slice(0, 10).join(", ")}${successSymbols.length > 10 ? `... (共${successSymbols.length}个)` : ""}`,
      );
    }

    // 显示失败的币种
    if (failedSymbols.length > 0) {
      this.logger.warn(
        `❌ 失败的币种: ${failedSymbols.slice(0, 10).join(", ")}${failedSymbols.length > 10 ? `... (共${failedSymbols.length}个)` : ""}`,
      );

      // 对少量失败的交易对进行二次重试（使用更保守的设置）
      if (failedSymbols.length < symbols.length * 0.15) {
        this.logger.log(
          `🔄 对 ${failedSymbols.length} 个失败的交易对进行保守重试...`,
        );
        await this.retryFailedPeriodUpdate(
          volumeWindows,
          failedSymbols,
          new Date(periodStart),
          new Date(periodEnd),
          window24hStart,
        );
      } else {
        this.logger.warn(
          `⚠️ 失败交易对过多 (${failedSymbols.length}/${symbols.length})，跳过重试以避免影响整体进度`,
        );
      }
    }
  }

  /**
   * 对失败的周期更新进行单独重试
   */
  private async retryFailedPeriodUpdate(
    volumeWindows: Map<string, VolumeWindow>,
    failedSymbols: string[],
    periodStart: Date,
    periodEnd: Date,
    window24hStart: number,
  ): Promise<void> {
    if (failedSymbols.length === 0) return;

    this.logger.log(
      `🔄 开始单独重试 ${failedSymbols.length} 个失败的交易对...`,
    );

    let retrySuccessCount = 0;
    const stillFailedSymbols: string[] = [];

    // 对失败的交易对逐个重试，使用更长的延迟
    for (const symbol of failedSymbols) {
      try {
        const result = await this.loadSymbolKlinesWithRetry(
          symbol,
          periodStart,
          periodEnd,
          3,
        ); // 增加重试次数

        if (result.data && result.data.length > 0) {
          const window = volumeWindows.get(symbol);
          if (window) {
            // 添加新数据
            window.data.push(...result.data);
            // 移除超过24小时的旧数据
            window.data = window.data.filter(
              (kline) => kline.openTime >= window24hStart,
            );
            // 重新计算24小时成交量
            this.updateWindowVolume(window);
            retrySuccessCount++;
          }
        } else {
          stillFailedSymbols.push(symbol);
        }

        // 重试时使用更长的延迟
        await this.delay(this.configService.binanceRequestDelay * 2);
      } catch (error) {
        stillFailedSymbols.push(symbol);
        this.logger.error(`💥 ${symbol}: 重试时发生异常 - ${error.message}`);
      }
    }

    const retrySuccessRate = (
      (retrySuccessCount / failedSymbols.length) *
      100
    ).toFixed(1);
    this.logger.log(
      `📊 周期更新重试完成: 成功 ${retrySuccessCount}/${failedSymbols.length} (${retrySuccessRate}%)`,
    );

    // 收集发生异常的币种并汇总显示
    const retryErrorSymbols = failedSymbols.filter((symbol) =>
      stillFailedSymbols.includes(symbol),
    );
    if (retryErrorSymbols.length > 0) {
      this.logger.error(
        `💥 周期更新重试时发生异常的币种: ${retryErrorSymbols.slice(0, 10).join(", ")}${retryErrorSymbols.length > 10 ? `... (共${retryErrorSymbols.length}个)` : ""}`,
      );
    }

    if (stillFailedSymbols.length > 0) {
      this.logger.warn(
        `⚠️ 仍有 ${stillFailedSymbols.length} 个交易对无法获取周期数据: ${stillFailedSymbols.slice(0, 5).join(", ")}${stillFailedSymbols.length > 5 ? "..." : ""}`,
      );
    }
  }

  /**
   * 加载指定交易对的K线数据（带重试机制）
   */
  private async loadSymbolKlines(
    symbol: string,
    startTime: Date,
    endTime: Date,
    maxRetries: number = 3,
  ): Promise<KlineData[] | null> {
    const timeRange = `${startTime.toISOString().slice(0, 16)} - ${endTime.toISOString().slice(0, 16)}`;
    // 将日志级别从DEBUG调整为更高级别，避免批量获取时的干扰
    // this.logger.debug(`🔍 开始获取 ${symbol} K线数据 (${timeRange})`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const klines = await this.binanceService.getKlines({
          symbol,
          interval: "1h",
          startTime: startTime.getTime(),
          endTime: endTime.getTime(),
          limit: 1000,
        });

        if (attempt > 1) {
          this.logger.log(
            `✅ ${symbol} K线数据重试获取成功 - 第${attempt}次尝试，获得${klines?.length || 0}条数据`,
          );
        }
        // 取消成功时的DEBUG日志，避免串行日志干扰
        // else {
        //   this.logger.debug(`✅ ${symbol} K线数据获取成功 - 获得${klines?.length || 0}条数据`);
        // }

        return klines;
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const errorMsg =
          error.response?.data?.msg || error.message || "未知错误";

        if (isLastAttempt) {
          this.logger.error(`❌ ${symbol} K线数据最终获取失败 (${timeRange})`);
          this.logger.error(`   已重试 ${maxRetries} 次，错误: ${errorMsg}`);
          return null;
        } else {
          this.logger.warn(`⚠️ ${symbol} K线数据获取失败 (${timeRange})`);
          this.logger.warn(
            `   第 ${attempt}/${maxRetries} 次重试，错误: ${errorMsg}`,
          );

          // 指数退避策略：每次失败后等待时间翻倍
          const delayTime =
            this.configService.binanceRequestDelay * Math.pow(2, attempt - 1);
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
    window.volume24h = window.data.reduce(
      (sum, kline) => sum + parseFloat(kline.volume),
      0,
    );
    window.quoteVolume24h = window.data.reduce(
      (sum, kline) => sum + parseFloat(kline.quoteVolume),
      0,
    );
  }

  /**
   * 计算排行榜
   */
  private calculateRankings(
    volumeWindows: Map<string, VolumeWindow>,
    limit: number,
    minVolumeThreshold: number,
  ): HourlyVolumeRankingItem[] {
    const rankings: HourlyVolumeRankingItem[] = [];

    for (const [symbol, window] of volumeWindows) {
      if (
        window.quoteVolume24h >= minVolumeThreshold &&
        window.data.length > 0
      ) {
        const latestKline = window.data[window.data.length - 1];
        const baseAsset = symbol
          .replace("USDT", "")
          .replace("BTC", "")
          .replace("ETH", "");
        const quoteAsset = symbol.includes("USDT")
          ? "USDT"
          : symbol.includes("BTC")
            ? "BTC"
            : "ETH";

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
    const totalQuoteVolume = rankings.reduce(
      (sum, item) => sum + item.quoteVolume24h,
      0,
    );
    rankings.forEach((item, index) => {
      item.rank = index + 1;
      item.marketShare =
        totalQuoteVolume > 0
          ? (item.quoteVolume24h / totalQuoteVolume) * 100
          : 0;
    });

    return rankings.slice(0, limit);
  }

  /**
   * 计算市场统计数据
   */
  private calculateMarketStats(rankings: HourlyVolumeRankingItem[]) {
    return {
      totalVolume: rankings.reduce((sum, item) => sum + item.volume24h, 0),
      totalQuoteVolume: rankings.reduce(
        (sum, item) => sum + item.quoteVolume24h,
        0,
      ),
      activePairs: rankings.length,
    };
  }

  /**
   * 计算市场集中度（前10名份额）
   */
  private calculateMarketConcentration(
    rankings: HourlyVolumeRankingItem[],
  ): number {
    const top10Volume = rankings
      .slice(0, 10)
      .reduce((sum, item) => sum + item.quoteVolume24h, 0);
    const totalVolume = rankings.reduce(
      (sum, item) => sum + item.quoteVolume24h,
      0,
    );
    return totalVolume > 0 ? (top10Volume / totalVolume) * 100 : 0;
  }

  /**
   * 保存单个回测结果到数据库
   */
  private async saveSingleBacktestResult(
    result: VolumeBacktest,
  ): Promise<void> {
    try {
      const savedResult = new this.volumeBacktestModel(result);
      await savedResult.save();
    } catch (error) {
      // 检查是否是重复数据错误
      if (error.code === 11000) {
        this.logger.warn(
          `⚠️ 数据已存在，跳过保存: ${result.timestamp.toISOString()}`,
        );
      } else {
        throw error;
      }
    }
  }

  /**
   * 保存回测结果到数据库（批量保存，保留兼容性）
   */


  /**
   * 查询历史回测数据
   */
  async getBacktestResults(
    startTime?: Date,
    endTime?: Date,
    symbol?: string,
  ): Promise<VolumeBacktest[]> {
    const query: any = {};

    if (startTime || endTime) {
      query.timestamp = {};
      if (startTime) query.timestamp.$gte = startTime;
      if (endTime) query.timestamp.$lte = endTime;
    }

    if (symbol) {
      query["rankings.symbol"] = symbol;
    }

    return this.volumeBacktestModel.find(query).sort({ timestamp: 1 }).exec();
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
   * 改进的批量预加载方法（带错误处理和重试）
   */
  private async preloadVolumeWindowsWithRetry(
    volumeWindows: Map<string, VolumeWindow>,
    startTime: Date,
    endTime: Date,
  ): Promise<void> {
    this.logger.log("📊 开始优化并发预加载初始数据窗口（自适应重试机制）...");

    const symbols = Array.from(volumeWindows.keys());
    const timeRange = `${startTime.toISOString().slice(0, 16)} - ${endTime.toISOString().slice(0, 16)}`;

    this.logger.log(
      `📦 需要处理 ${symbols.length} 个交易对的数据 (${timeRange})`,
    );

    // 使用优化的并发预加载
    await this.preloadVolumeWindowsOptimized(
      volumeWindows,
      startTime,
      endTime,
      {
        maxConcurrency: 12, // 增加并发数
        batchSize: 40, // 优化批次大小
      },
    );

    // 检查预加载结果并记录统计信息
    let successCount = 0;
    let failureCount = 0;
    const failedSymbols: string[] = [];
    const successSymbols: string[] = [];

    for (const [symbol, window] of volumeWindows) {
      if (window.data && window.data.length > 0) {
        successCount++;
        successSymbols.push(symbol);
      } else {
        failedSymbols.push(symbol);
        failureCount++;
      }
    }

    const successRate = ((successCount / symbols.length) * 100).toFixed(1);
    this.logger.log(
      `📊 优化预加载完成: 成功 ${successCount}/${symbols.length} (${successRate}%), 失败 ${failureCount}`,
    );

    // 显示成功的币种详情（限制数量）
    if (successSymbols.length > 0) {
      this.logger.debug(
        `✅ 成功预加载的币种: ${successSymbols.slice(0, 10).join(", ")}${successSymbols.length > 10 ? `... (共${successSymbols.length}个)` : ""}`,
      );
    }

    // 显示失败的币种并进行重试
    if (failedSymbols.length > 0) {
      this.logger.warn(
        `❌ 预加载失败的币种: ${failedSymbols.slice(0, 10).join(", ")}${failedSymbols.length > 10 ? `... (共${failedSymbols.length}个)` : ""}`,
      );

      // 对失败的交易对进行单独重试（降低并发数）
      if (failedSymbols.length < symbols.length * 0.3) {
        this.logger.log(
          `🔄 对 ${failedSymbols.length} 个失败的交易对进行单独重试...`,
        );
        await this.retryFailedPreload(
          volumeWindows,
          failedSymbols,
          startTime,
          endTime,
        );
      }
    }

    // 记录最终统计信息
    this.logDataStatistics(volumeWindows, "预加载完成后");

    const stats = this.calculateDataSuccessRate(volumeWindows);
    const successRateNum = parseFloat(stats.successRate.replace("%", ""));
    if (successRateNum < 85) {
      this.logger.warn(
        `⚠️ 数据获取成功率较低 (${stats.successRate})，可能影响回测准确性`,
      );
    } else {
      this.logger.log(`✅ 数据质量良好 (${stats.successRate} 成功率)`);
    }
  }

  /**
   * 对失败的预加载进行单独重试
   */
  private async retryFailedPreload(
    volumeWindows: Map<string, VolumeWindow>,
    failedSymbols: string[],
    startTime: Date,
    endTime: Date,
  ): Promise<void> {
    if (failedSymbols.length === 0) return;

    this.logger.log(
      `🔄 开始单独重试 ${failedSymbols.length} 个失败的交易对...`,
    );

    let retrySuccessCount = 0;
    const stillFailedSymbols: string[] = [];
    const retryErrorSymbols: string[] = [];

    // 对失败的交易对逐个重试，使用更长的延迟
    for (const symbol of failedSymbols) {
      try {
        const result = await this.loadSymbolKlinesWithRetry(
          symbol,
          startTime,
          endTime,
          5,
        ); // 增加重试次数

        if (result.data && result.data.length > 0) {
          const window = volumeWindows.get(symbol);
          if (window) {
            window.data = result.data;
            this.updateWindowVolume(window);
            retrySuccessCount++;
          }
        } else {
          stillFailedSymbols.push(symbol);
        }

        // 重试时使用更长的延迟
        await this.delay(this.configService.binanceRequestDelay * 2);
      } catch (error) {
        stillFailedSymbols.push(symbol);
        retryErrorSymbols.push(symbol);
      }
    }

    const retrySuccessRate = (
      (retrySuccessCount / failedSymbols.length) *
      100
    ).toFixed(1);
    this.logger.log(
      `📊 预加载重试完成: 成功 ${retrySuccessCount}/${failedSymbols.length} (${retrySuccessRate}%)`,
    );

    // 显示发生异常的币种汇总
    if (retryErrorSymbols.length > 0) {
      this.logger.error(
        `💥 预加载重试时发生异常的币种: ${retryErrorSymbols.slice(0, 10).join(", ")}${retryErrorSymbols.length > 10 ? `... (共${retryErrorSymbols.length}个)` : ""}`,
      );
    }

    if (stillFailedSymbols.length > 0) {
      this.logger.warn(
        `⚠️ 仍有 ${stillFailedSymbols.length} 个交易对无法获取预加载数据: ${stillFailedSymbols.slice(0, 5).join(", ")}${stillFailedSymbols.length > 5 ? "..." : ""}`,
      );
    }
  }

  /**
   * 最终数据完整性检查和修复
   */
  private async finalDataIntegrityCheck(
    volumeWindows: Map<string, VolumeWindow>,
    startTime: Date,
    endTime: Date,
  ): Promise<void> {
    this.logger.log("🔍 开始最终数据完整性检查...");

    const stats = this.calculateDataSuccessRate(volumeWindows);

    if (stats.failedSymbols.length === 0) {
      this.logger.log("✅ 所有交易对数据完整");
      return;
    }

    this.logger.warn(
      `🚨 发现 ${stats.failedSymbols.length} 个交易对数据不完整，开始最终修复...`,
    );

    // 对于数据不完整的交易对，尝试最后一次修复
    const repairPromises = stats.failedSymbols.map(async (symbol) => {
      try {
        // 计算整个回测期间的数据
        const fullPeriodKlines = await this.loadSymbolKlines(
          symbol,
          new Date(startTime.getTime() - 24 * 60 * 60 * 1000), // 包括预加载期
          endTime,
          2, // 最多重试2次
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
    const repairedCount = repairResults.filter((r) => r.success).length;
    const stillFailedCount = repairResults.filter((r) => !r.success).length;

    this.logger.log(
      `🔧 数据修复完成: 成功修复 ${repairedCount} 个，仍然失败 ${stillFailedCount} 个`,
    );

    // 最终统计
    this.logDataStatistics(volumeWindows, "最终数据完整性检查");
  }

  /**
   * 生成筛选条件的哈希值
   */
  private generateFilterHash(
    startTime: Date,
    params: VolumeBacktestParamsDto,
  ): string {
    const filterCriteria = {
      referenceTime: startTime.toISOString().slice(0, 10), // 只使用日期部分
      quoteAsset: params.quoteAsset || "USDT",
      minVolumeThreshold: params.minVolumeThreshold || 10000,
      minHistoryDays: params.minHistoryDays || 365,
      requireFutures: params.requireFutures || false,
      excludeStablecoins: params.excludeStablecoins ?? true,
      includeInactive: params.includeInactive || false,
    };

    const criteriaString = JSON.stringify(
      filterCriteria,
      Object.keys(filterCriteria).sort(),
    );
    return createHash("sha256").update(criteriaString).digest("hex");
  }

  /**
   * 从缓存中获取筛选结果
   */
  private async getFilterFromCache(filterHash: string): Promise<{
    valid: string[];
    invalid: string[];
    invalidReasons: { [symbol: string]: string[] };
  } | null> {
    try {
      const cached = await this.symbolFilterCacheModel.findOne({ filterHash });

      if (!cached) {
        return null;
      }

      // 更新最后使用时间和命中次数
      await this.symbolFilterCacheModel.updateOne(
        { filterHash },
        {
          $set: { lastUsedAt: new Date() },
          $inc: { hitCount: 1 },
        },
      );

      this.logger.log(
        `🎯 缓存命中! 使用已存储的筛选结果 (${cached.validSymbols.length} 个有效交易对)`,
      );
      this.logger.log(
        `   缓存创建时间: ${cached.createdAt.toISOString().slice(0, 19)}`,
      );
      this.logger.log(`   缓存命中次数: ${cached.hitCount + 1}`);

      return {
        valid: cached.validSymbols,
        invalid: cached.invalidSymbols,
        invalidReasons: cached.invalidReasons,
      };
    } catch (error) {
      this.logger.warn(`缓存查询失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 将筛选结果保存到缓存
   */
  private async saveFilterToCache(
    filterHash: string,
    startTime: Date,
    params: VolumeBacktestParamsDto,
    filterResult: {
      valid: string[];
      invalid: string[];
      invalidReasons: { [symbol: string]: string[] };
    },
    allSymbols: string[],
    processingTime: number,
  ): Promise<void> {
    try {
      // 计算统计信息
      const reasonStats: { [reason: string]: number } = {};
      Object.values(filterResult.invalidReasons).forEach((reasons) => {
        reasons.forEach((reason) => {
          reasonStats[reason] = (reasonStats[reason] || 0) + 1;
        });
      });

      const validRate = (
        (filterResult.valid.length / allSymbols.length) *
        100
      ).toFixed(1);

      const filterCriteria = {
        referenceTime: startTime.toISOString().slice(0, 10),
        quoteAsset: params.quoteAsset,
        minVolumeThreshold: params.minVolumeThreshold || 10000,
        minHistoryDays: params.minHistoryDays || 365,
        requireFutures: params.requireFutures || false,
        excludeStablecoins: params.excludeStablecoins ?? true,
        includeInactive: params.includeInactive || false,
      };

      const statistics = {
        totalDiscovered: allSymbols.length,
        validSymbols: filterResult.valid.length,
        invalidSymbols: filterResult.invalid.length,
        validRate: validRate + "%",
        reasonStats,
      };

      // 使用 upsert 以防重复
      await this.symbolFilterCacheModel.updateOne(
        { filterHash },
        {
          $set: {
            filterCriteria,
            validSymbols: filterResult.valid,
            invalidSymbols: filterResult.invalid,
            invalidReasons: filterResult.invalidReasons,
            statistics,
            processingTime,
            lastUsedAt: new Date(),
          },
          $inc: { hitCount: 0 }, // 如果是新记录，hitCount 为 0
        },
        { upsert: true },
      );

      this.logger.log(
        `💾 筛选结果已保存到缓存 (Hash: ${filterHash.slice(0, 8)}...)`,
      );
      this.logger.log(
        `   有效交易对: ${filterResult.valid.length}/${allSymbols.length} (${validRate}%)`,
      );
    } catch (error) {
      this.logger.warn(`保存筛选结果到缓存失败: ${error.message}`);
      // 不抛出错误，因为缓存失败不应该影响主流程
    }
  }

  /**
   * 清理过期的缓存记录
   */
  async cleanupFilterCache(olderThanDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.symbolFilterCacheModel.deleteMany({
        lastUsedAt: { $lt: cutoffDate },
      });

      this.logger.log(
        `🧹 清理了 ${result.deletedCount} 个过期的筛选缓存记录 ( 超过${olderThanDays}天未使用)`,
      );
    } catch (error) {
      this.logger.error(`清理筛选缓存失败: ${error.message}`);
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getFilterCacheStats(): Promise<{
    totalCaches: number;
    totalHitCount: number;
    avgHitCount: number;
    oldestCache: Date | null;
    newestCache: Date | null;
  }> {
    try {
      const stats = await this.symbolFilterCacheModel.aggregate([
        {
          $group: {
            _id: null,
            totalCaches: { $sum: 1 },
            totalHitCount: { $sum: "$hitCount" },
            avgHitCount: { $avg: "$hitCount" },
            oldestCache: { $min: "$createdAt" },
            newestCache: { $max: "$createdAt" },
          },
        },
      ]);

      return (
        stats[0] || {
          totalCaches: 0,
          totalHitCount: 0,
          avgHitCount: 0,
          oldestCache: null,
          newestCache: null,
        }
      );
    } catch (error) {
      this.logger.error(`获取缓存统计失败: ${error.message}`);
      return {
        totalCaches: 0,
        totalHitCount: 0,
        avgHitCount: 0,
        oldestCache: null,
        newestCache: null,
      };
    }
  }

  /**
   * 检查是否为稳定币交易对
   */
  private isStablecoinPair(symbol: string): boolean {
    const baseAsset = this.extractBaseAsset(symbol);
    return this.STABLECOINS.includes(baseAsset);
  }

  /**
   * 从交易对中提取基础资产
   */
  private extractBaseAsset(symbol: string): string {
    const quoteAssets = ["USDT", "USDC", "BTC", "ETH", "BNB", "BUSD", "FDUSD"];

    for (const quote of quoteAssets) {
      if (symbol.endsWith(quote)) {
        return symbol.slice(0, -quote.length);
      }
    }

    return symbol;
  }

  /**
   * 检查单个交易对的历史数据是否充足
   */
  private async checkSymbolHistoryData(
    symbol: string,
    historyStart: Date,
    historyEnd: Date,
  ): Promise<boolean> {
    try {
      const testKlines = await this.binanceService.getKlines({
        symbol,
        interval: "1d",
        startTime: historyStart.getTime(),
        endTime: historyEnd.getTime(),
        limit: 10,
      });

      if (!testKlines || testKlines.length === 0) {
        return false;
      }

      const earliestTime = testKlines[0].openTime;
      const requiredTime = historyStart.getTime();
      const timeDifference = Math.abs(earliestTime - requiredTime);
      const daysDifference = timeDifference / (24 * 60 * 60 * 1000);

      return daysDifference <= 30;
    } catch (error) {
      if (
        error.response?.status === 400 &&
        error.response?.data?.code === -1121
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 记录数据统计信息
   */
  private logDataStatistics(
    volumeWindows: Map<string, VolumeWindow>,
    stage: string,
  ): void {
    const totalSymbols = volumeWindows.size;
    let symbolsWithData = 0;
    let totalDataPoints = 0;

    for (const [, window] of volumeWindows) {
      if (window.data.length > 0) {
        symbolsWithData++;
        totalDataPoints += window.data.length;
      }
    }

    const avgDataPoints =
      symbolsWithData > 0
        ? (totalDataPoints / symbolsWithData).toFixed(1)
        : "0";
    const dataRate =
      totalSymbols > 0
        ? ((symbolsWithData / totalSymbols) * 100).toFixed(1)
        : "0";

    this.logger.log(`📊 ${stage} 数据统计:`);
    this.logger.log(`   交易对总数: ${totalSymbols}`);
    this.logger.log(`   有数据的交易对: ${symbolsWithData} (${dataRate}%)`);
    this.logger.log(`   平均数据点数: ${avgDataPoints}`);
  }

  /**
   * 计算数据成功率
   */
  private calculateDataSuccessRate(volumeWindows: Map<string, VolumeWindow>): {
    totalSymbols: number;
    successfulSymbols: number;
    successRate: string;
    failedSymbols: string[];
  } {
    const totalSymbols = volumeWindows.size;
    let successfulSymbols = 0;
    const failedSymbols: string[] = [];

    for (const [symbol, window] of volumeWindows) {
      if (window.data.length > 0) {
        successfulSymbols++;
      } else {
        failedSymbols.push(symbol);
      }
    }

    const successRate =
      totalSymbols > 0
        ? ((successfulSymbols / totalSymbols) * 100).toFixed(1)
        : "0";

    return {
      totalSymbols,
      successfulSymbols,
      successRate: successRate + "%",
      failedSymbols: failedSymbols.slice(0, 10), // 只显示前10个失败的
    };
  }

  /**
   * 独立的并发筛选方法（用于测试和优化）
   */
  async filterSymbolsConcurrently(
    symbols: string[],
    params: {
      minHistoryDays?: number;
      requireFutures?: boolean;
      excludeStablecoins?: boolean;
      concurrency?: number;
      referenceTime?: Date;
    } = {},
  ): Promise<{
    valid: string[];
    invalid: string[];
    invalidReasons: { [symbol: string]: string[] };
    stats: {
      totalProcessed: number;
      processingTime: number;
      concurrency: number;
      avgTimePerSymbol: number;
    };
  }> {
    const startTime = Date.now();
    const concurrency = params.concurrency || 5;
    const minHistoryDays = params.minHistoryDays || 365;
    const requireFutures = params.requireFutures || false;
    const excludeStablecoins = params.excludeStablecoins ?? true;
    const referenceTime = params.referenceTime || new Date();

    this.logger.log(
      `🚀 并发筛选启动: ${symbols.length} 个交易对 | 并发数: ${concurrency} | 历史要求: ${minHistoryDays}天`,
    );

    const validSymbols: string[] = [];
    const invalidSymbols: string[] = [];
    const invalidReasons: { [symbol: string]: string[] } = {};

    // 计算历史检查时间范围
    const requiredHistoryStart = new Date(
      referenceTime.getTime() - minHistoryDays * 24 * 60 * 60 * 1000,
    );
    const checkEndTime = new Date(
      referenceTime.getTime() - 7 * 24 * 60 * 60 * 1000,
    );

    // 批量获取期货合约信息
    let futuresAvailability: { [symbol: string]: boolean } = {};
    if (requireFutures) {
      try {
        futuresAvailability =
          await this.binanceService.checkFuturesAvailability(symbols);
        const withFutures =
          Object.values(futuresAvailability).filter(Boolean).length;
        this.logger.log(
          `� 期货检查完成: ${withFutures}/${symbols.length} 个有永续合约`,
        );
      } catch (error) {
        this.logger.error(`期货检查失败: ${error.message}`);
        symbols.forEach((symbol) => (futuresAvailability[symbol] = false));
      }
    }

    // 创建处理队列
    const symbolQueue = [...symbols];
    const results = new Map<string, { valid: boolean; reasons: string[] }>();
    const processedCount = { value: 0 };

    // 并发处理函数
    const processSymbol = async (symbol: string): Promise<void> => {
      const reasons: string[] = [];
      let isValid = true;

      try {
        // 检查1: 稳定币过滤
        if (excludeStablecoins && this.isStablecoinPair(symbol)) {
          reasons.push("稳定币交易对");
          isValid = false;
        }

        // 检查2: 期货合约要求
        if (requireFutures && !futuresAvailability[symbol]) {
          reasons.push("无永续合约");
          isValid = false;
        }

        // 检查3: 历史数据要求
        if (isValid) {
          const hasValidHistory = await this.checkSymbolHistoryData(
            symbol,
            requiredHistoryStart,
            checkEndTime,
          );

          if (!hasValidHistory) {
            reasons.push(`历史数据不足${minHistoryDays}天`);
            isValid = false;
          }
        }

        results.set(symbol, { valid: isValid, reasons });
        processedCount.value++;

        // 简化进度日志 - 每25个输出一次
        if (
          processedCount.value % 25 === 0 ||
          processedCount.value === symbols.length
        ) {
          const progress = (
            (processedCount.value / symbols.length) *
            100
          ).toFixed(1);
          const recentValid =
            results.size > 0
              ? Array.from(results.values())
                  .slice(-25)
                  .filter((r) => r.valid).length
              : 0;
          this.logger.log(
            `⏳ ${processedCount.value}/${symbols.length} (${progress}%) | 最近25个: ${recentValid}✅`,
          );
        }

        // 控制API调用频率
        await this.delay(this.configService.binanceRequestDelay);
      } catch (error) {
        results.set(symbol, {
          valid: false,
          reasons: [`检查失败: ${error.message}`],
        });
        processedCount.value++;
        this.logger.warn(`⚠️ ${symbol} 检查失败: ${error.message}`);
      }
    };

    // 使用 Promise 限制并发数量
    const processInBatches = async (
      symbols: string[],
      batchSize: number,
    ): Promise<void> => {
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        await Promise.all(batch.map((symbol) => processSymbol(symbol)));
      }
    };

    // 执行并发处理
    await processInBatches(symbolQueue, concurrency);

    // 整理结果
    for (const [symbol, result] of results) {
      if (result.valid) {
        validSymbols.push(symbol);
      } else {
        invalidSymbols.push(symbol);
        invalidReasons[symbol] = result.reasons;
      }
    }

    const processingTime = Date.now() - startTime;
    const avgTimePerSymbol = processingTime / symbols.length;

    this.logger.log(
      `✅ 并发筛选完成: ${validSymbols.length}/${symbols.length} (${((validSymbols.length / symbols.length) * 100).toFixed(1)}%) | 耗时: ${processingTime}ms | 平均: ${avgTimePerSymbol.toFixed(0)}ms/个`,
    );

    return {
      valid: validSymbols,
      invalid: invalidSymbols,
      invalidReasons,
      stats: {
        totalProcessed: symbols.length,
        processingTime,
        concurrency,
        avgTimePerSymbol,
      },
    };
  }

  /**
   * 获取回测期间涉及的所有周一时间点
   */
  private getWeeklySymbolCalculationTimes(
    startTime: Date,
    endTime: Date,
  ): Date[] {
    const weeklyTimes: Date[] = [];
    const current = new Date(startTime.getTime());

    // 找到第一个周一
    while (current.getDay() !== 1) {
      current.setDate(current.getDate() - 1);
    }

    // 从第一个周一开始，每周添加一个时间点
    while (current <= endTime) {
      weeklyTimes.push(new Date(current));
      current.setDate(current.getDate() + 7); // 加7天到下一个周一
    }

    return weeklyTimes;
  }

  /**
   * 使用周期性symbols计算每小时排行榜
   */
  private async calculateHourlyRankingsWithWeeklySymbols(
    weeklySymbolsMap: Map<string, string[]>,
    startTime: Date,
    endTime: Date,
    params: VolumeBacktestParamsDto,
  ): Promise<void> {
    const granularityMs = (params.granularityHours || 1) * 60 * 60 * 1000;
    const currentTime = new Date(startTime.getTime());

    while (currentTime < endTime) {
      // 找到当前时间对应的周一
      const weekStart = new Date(currentTime.getTime());
      while (weekStart.getDay() !== 1) {
        weekStart.setDate(weekStart.getDate() - 1);
      }
      weekStart.setHours(0, 0, 0, 0);

      const weekKey = weekStart.toISOString().slice(0, 10);
      const symbols = weeklySymbolsMap.get(weekKey) || [];

      if (symbols.length > 0) {
        // 使用简化的单周期计算逻辑，而不是批量处理
        this.logger.log(`📊 为周期 ${currentTime.toISOString()} 计算 ${symbols.length} 个交易对的排行榜`);
        
        // 这里应该调用新的单周期计算方法
        // TODO: 实现单周期计算逻辑
        this.logger.warn(`⚠️ 周期性计算功能正在重构中，跳过此周期`);
      }

      currentTime.setTime(currentTime.getTime() + granularityMs);
    }
  }

  /**
   * 带重试机制的K线数据加载
   */
  private async loadSymbolKlinesWithRetry(
    symbol: string,
    startTime: Date,
    endTime: Date,
    maxRetries: number = 3,
  ): Promise<{ data: KlineData[] | null; error?: string }> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const data = await this.loadSymbolKlines(symbol, startTime, endTime);
        return { data };
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `💥 ${symbol} K线加载失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`,
        );

        if (attempt < maxRetries) {
          // 指数退避重试
          const delay = Math.pow(2, attempt) * 1000;
          await this.delay(delay);
        }
      }
    }

    return {
      data: null,
      error: `加载失败 (${maxRetries}次重试): ${lastError?.message || "未知错误"}`,
    };
  }

  /**
   * 高级并发处理池 - 支持动态调整并发数
   */
  private async processConcurrentlyWithPool<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: {
      initialConcurrency?: number;
      maxConcurrency?: number;
      minConcurrency?: number;
      adaptiveThrottling?: boolean;
      retryFailedItems?: boolean;
      maxRetries?: number;
    } = {},
  ): Promise<{ results: Map<T, R>; errors: Map<T, Error>; stats: any }> {
    const {
      initialConcurrency = 5,
      maxConcurrency = 20,
      minConcurrency = 1,
      adaptiveThrottling = true,
      retryFailedItems = true,
      maxRetries = 3,
    } = options;

    const results = new Map<T, R>();
    const errors = new Map<T, Error>();
    const metrics = {
      processed: 0,
      failed: 0,
      retried: 0,
      totalTime: 0,
      avgResponseTime: 0,
      currentConcurrency: initialConcurrency,
      concurrencyAdjustments: 0,
    };

    let currentConcurrency = initialConcurrency;
    const queue = [...items];
    const activePromises = new Set<Promise<void>>();
    const responseTimings: number[] = [];
    const errorRates: number[] = [];

    const startTime = Date.now();

    const processItem = async (item: T, attempt: number = 1): Promise<void> => {
      const itemStartTime = Date.now();

      try {
        const result = await processor(item);
        results.set(item, result);
        metrics.processed++;

        const responseTime = Date.now() - itemStartTime;
        responseTimings.push(responseTime);

        // 保持最近100次的响应时间记录
        if (responseTimings.length > 100) {
          responseTimings.shift();
        }
      } catch (error) {
        metrics.failed++;

        if (retryFailedItems && attempt < maxRetries) {
          metrics.retried++;
          this.logger.warn(
            `⚠️ 项目处理失败，正在重试 (${attempt}/${maxRetries}): ${error.message}`,
          );
          await this.delay(Math.pow(2, attempt) * 1000); // 指数退避
          return processItem(item, attempt + 1);
        } else {
          errors.set(item, error as Error);
          this.logger.error(`❌ 项目处理最终失败: ${error.message}`);
        }
      }
    };

    const adjustConcurrency = () => {
      if (!adaptiveThrottling) return;

      const recentResponseTimes = responseTimings.slice(-20);
      const recentErrors = errorRates.slice(-10);

      if (recentResponseTimes.length >= 10) {
        const avgResponseTime =
          recentResponseTimes.reduce((a, b) => a + b, 0) /
          recentResponseTimes.length;
        const recentErrorRate =
          recentErrors.length > 0
            ? recentErrors.reduce((a, b) => a + b, 0) / recentErrors.length
            : 0;

        // 如果响应时间变慢或错误率增加，降低并发数
        if (avgResponseTime > 5000 || recentErrorRate > 0.1) {
          if (currentConcurrency > minConcurrency) {
            currentConcurrency = Math.max(
              minConcurrency,
              Math.floor(currentConcurrency * 0.8),
            );
            metrics.concurrencyAdjustments++;
            this.logger.log(
              `⬇️ 降低并发数至 ${currentConcurrency} (响应时间: ${avgResponseTime.toFixed(0)}ms, 错误率: ${(recentErrorRate * 100).toFixed(1)}%)`,
            );
          }
        }
        // 如果性能良好，适度增加并发数
        else if (
          avgResponseTime < 2000 &&
          recentErrorRate < 0.05 &&
          currentConcurrency < maxConcurrency
        ) {
          currentConcurrency = Math.min(maxConcurrency, currentConcurrency + 1);
          metrics.concurrencyAdjustments++;
          this.logger.log(`⬆️ 增加并发数至 ${currentConcurrency} (性能良好)`);
        }
      }
    };

    // 主处理循环
    while (queue.length > 0 || activePromises.size > 0) {
      // 填充活跃任务池
      while (queue.length > 0 && activePromises.size < currentConcurrency) {
        const item = queue.shift()!;
        const promise = processItem(item).then(() => {
          activePromises.delete(promise);
        });
        activePromises.add(promise);
      }

      // 等待至少一个任务完成
      if (activePromises.size > 0) {
        await Promise.race(activePromises);
      }

      // 每处理一定数量后调整并发数
      if ((metrics.processed + metrics.failed) % 20 === 0) {
        adjustConcurrency();
      }

      // 计算错误率
      const totalProcessed = metrics.processed + metrics.failed;
      if (totalProcessed > 0) {
        const currentErrorRate = metrics.failed / totalProcessed;
        errorRates.push(currentErrorRate);
        if (errorRates.length > 10) {
          errorRates.shift();
        }
      }
    }

    metrics.totalTime = Date.now() - startTime;
    metrics.avgResponseTime =
      responseTimings.length > 0
        ? responseTimings.reduce((a, b) => a + b, 0) / responseTimings.length
        : 0;
    metrics.currentConcurrency = currentConcurrency;

    this.logger.log(
      `🎯 并发处理完成: ${metrics.processed}/${items.length} 成功, ${metrics.failed} 失败, ${metrics.retried} 重试`,
    );
    this.logger.log(
      `   总耗时: ${metrics.totalTime}ms, 平均响应: ${metrics.avgResponseTime.toFixed(0)}ms, 最终并发数: ${currentConcurrency}`,
    );

    return { results, errors, stats: metrics };
  }

  /**
   * 批量处理K线数据 - 优化版本
   */
  private async loadKlinesBatchOptimized(
    symbols: string[],
    startTime: Date,
    endTime: Date,
    options: {
      maxConcurrency?: number;
      enableAdaptiveThrottling?: boolean;
      retryFailed?: boolean;
    } = {},
  ): Promise<Map<string, KlineData[] | null>> {
    const {
      maxConcurrency = 10,
      enableAdaptiveThrottling = true,
      retryFailed = true,
    } = options;

    this.logger.log(`🚀 开始优化批量加载 ${symbols.length} 个交易对的K线数据`);

    const processor = async (symbol: string): Promise<KlineData[] | null> => {
      try {
        return await this.loadSymbolKlines(symbol, startTime, endTime);
      } catch (error) {
        throw new Error(`${symbol}: ${error.message}`);
      }
    };

    const { results, errors } = await this.processConcurrentlyWithPool(
      symbols,
      processor,
      {
        maxConcurrency,
        adaptiveThrottling: enableAdaptiveThrottling,
        retryFailedItems: retryFailed,
        maxRetries: 3,
      },
    );

    // 转换结果格式
    const finalResults = new Map<string, KlineData[] | null>();

    for (const symbol of symbols) {
      if (results.has(symbol)) {
        finalResults.set(symbol, results.get(symbol)!);
      } else if (errors.has(symbol)) {
        this.logger.warn(
          `❌ ${symbol} 最终加载失败: ${errors.get(symbol)!.message}`,
        );
        finalResults.set(symbol, null);
      } else {
        finalResults.set(symbol, null);
      }
    }

    const successCount = Array.from(finalResults.values()).filter(
      (data) => data !== null,
    ).length;
    this.logger.log(
      `✅ 批量加载完成: ${successCount}/${symbols.length} 个交易对成功`,
    );

    return finalResults;
  }

  /**
   * 预加载数据 - 并发优化版本
   */
  private async preloadVolumeWindowsOptimized(
    volumeWindows: Map<string, VolumeWindow>,
    startTime: Date,
    endTime: Date,
    options: {
      maxConcurrency?: number;
      batchSize?: number;
    } = {},
  ): Promise<void> {
    const { maxConcurrency = 8, batchSize = 50 } = options;
    const symbols = Array.from(volumeWindows.keys());

    this.logger.log(`🔄 开始并发预加载 ${symbols.length} 个交易对的数据窗口`);

    // 分批处理以避免内存压力
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      this.logger.log(
        `   处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(symbols.length / batchSize)}: ${batch.length} 个交易对`,
      );

      const klineResults = await this.loadKlinesBatchOptimized(
        batch,
        startTime,
        endTime,
        { maxConcurrency, retryFailed: true },
      );

      // 更新数据窗口
      for (const [symbol, klineData] of klineResults) {
        const window = volumeWindows.get(symbol);
        if (window && klineData) {
          window.data = klineData;
          this.updateWindowVolume(window);
        }
      }

      // 批次间短暂暂停，避免API压力
      if (i + batchSize < symbols.length) {
        await this.delay(500);
      }
    }

    this.logger.log(`✅ 预加载完成: ${symbols.length} 个数据窗口已初始化`);
  }
}
