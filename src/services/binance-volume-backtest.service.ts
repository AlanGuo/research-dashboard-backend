import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import {
  VolumeBacktest,
  VolumeBacktestDocument,
} from "../models/volume-backtest.model";
import {
  SymbolFilterCache,
  SymbolFilterCacheDocument,
} from "../models/symbol-filter-cache.model";
import {
  AsyncBacktestTask,
  AsyncBacktestTaskDocument,
  TaskStatus,
} from "../models/async-backtest-task.model";
import {
  VolumeBacktestParamsDto,
  VolumeBacktestResponse,
  HourlyRankingItem,
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

interface FundingRateData {
  symbol: string;
  fundingTime: number;
  fundingRate: number;
  markPrice: number | string | undefined; // 币安API可能返回字符串或undefined
}

interface FundingRateHistoryItem {
  fundingTime: Date;
  fundingRate: number;
  markPrice: number | null; // 处理后的标记价格，可能为null
}

@Injectable()
export class BinanceVolumeBacktestService {
  private readonly logger = new Logger(BinanceVolumeBacktestService.name);

  // 统一的并发和批次配置
  private readonly CONCURRENCY_CONFIG = {
    // K线数据加载配置 (数据预加载、滑动窗口更新、单个时间点计算统一使用)
    // 原因: 都是相同的K线数据加载操作，对API的压力和网络要求相同
    KLINE_LOADING: {
      maxConcurrency: 12, // 较高并发，提升数据加载效率
      batchSize: 40, // 较大批次，减少网络往返次数
    },
    // 资金费率数据配置 (与fundingInfo共享500/5min/IP限制)
    FUNDING_RATE: {
      maxConcurrency: 5, // 保守的并发数，避免触发频率限制
      batchSize: 20, // 较小批次，控制请求频率
    },
    // 通用批量处理配置 (用于其他场景)
    GENERAL: {
      maxConcurrency: 10, // 平衡的并发数
      batchSize: 30, // 平衡的批次大小
    },
  };

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
    @InjectModel(AsyncBacktestTask.name)
    private asyncBacktestTaskModel: Model<AsyncBacktestTaskDocument>,
    private readonly configService: ConfigService,
    private readonly binanceService: BinanceService,
  ) {}

  /**
   * 启动异步成交量排行榜回测
   */
  async startAsyncVolumeBacktest(
    params: VolumeBacktestParamsDto,
  ): Promise<{ taskId: string }> {
    const taskId = uuidv4();

    // 创建异步任务记录
    const task = new this.asyncBacktestTaskModel({
      taskId,
      status: TaskStatus.PENDING,
      params,
      currentTime: params.startTime,
      startedAt: new Date(),
    });

    await task.save();

    // 异步执行回测
    this.executeAsyncVolumeBacktest(taskId).catch(async (error) => {
      this.logger.error(`异步回测任务 ${taskId} 执行失败:`, error);
      await this.updateTaskStatus(taskId, TaskStatus.FAILED, error.message);
    });

    return { taskId };
  }

  /**
   * 获取异步回测任务进度
   */
  async getAsyncBacktestProgress(taskId: string) {
    const task = await this.asyncBacktestTaskModel.findOne({ taskId }).exec();

    if (!task) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    // 动态计算运行时间
    let currentProcessingTime = task.processingTimeMs || 0;
    if (task.status === TaskStatus.RUNNING && task.startedAt) {
      currentProcessingTime = Date.now() - task.startedAt.getTime();
    }

    return {
      taskId: task.taskId,
      status: task.status,
      currentTime: task.currentTime,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      errorMessage: task.errorMessage,
      processingTimeMs: currentProcessingTime,
      // 不再返回result，因为结果数据已存储在VolumeBacktest集合中
    };
  }



  /**
   * 取消异步回测任务
   */
  async cancelAsyncBacktest(taskId: string) {
    const task = await this.asyncBacktestTaskModel.findOne({ taskId }).exec();

    if (!task) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    if (
      task.status === TaskStatus.COMPLETED ||
      task.status === TaskStatus.FAILED
    ) {
      throw new Error(`任务 ${taskId} 已完成，无法取消`);
    }

    await this.updateTaskStatus(taskId, TaskStatus.CANCELLED);

    return { message: `任务 ${taskId} 已取消` };
  }

  /**
   * 获取所有异步回测任务列表
   */
  async getAsyncBacktestTasks(limit = 20, offset = 0) {
    const tasks = await this.asyncBacktestTaskModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .exec();

    const total = await this.asyncBacktestTaskModel.countDocuments().exec();

    return {
      tasks: tasks.map((task) => {
        // 动态计算运行时间
        let currentProcessingTime = task.processingTimeMs || 0;
        if (task.status === TaskStatus.RUNNING && task.startedAt) {
          currentProcessingTime = Date.now() - task.startedAt.getTime();
        }

        return {
          taskId: task.taskId,
          status: task.status,
          currentTime: task.currentTime,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          processingTimeMs: currentProcessingTime,
          params: {
            startTime: task.params.startTime,
            endTime: task.params.endTime,
            granularityHours: task.params.granularityHours,
          },
        };
      }),
      total,
      limit,
      offset,
    };
  }

  /**
   * 私有方法：执行异步成交量排行榜回测
   */
  private async executeAsyncVolumeBacktest(taskId: string): Promise<void> {
    const task = await this.asyncBacktestTaskModel.findOne({ taskId }).exec();
    if (!task) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    const params = task.params;
    const startExecution = Date.now();

    try {
      await this.updateTaskStatus(taskId, TaskStatus.RUNNING);

      this.logger.log(`开始执行异步成交量回测 ${taskId}`);

      // 创建一个简单的进度更新函数
      const updateCurrentTime = async (currentTime: Date) => {
        await this.asyncBacktestTaskModel
          .updateOne(
            { taskId },
            { $set: { currentTime: currentTime.toISOString() } },
          )
          .exec();
      };

      // 直接调用现有的同步方法，并在计算过程中更新当前时间
      const result = await this.executeVolumeBacktestWithTimeTracking(
        params,
        updateCurrentTime,
      );

      const processingTime = Date.now() - startExecution;

      // 保存结果并更新任务状态
      await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, null, {
        processingTimeMs: processingTime,
      });

      this.logger.log(`异步回测任务 ${taskId} 完成，用时 ${processingTime}ms`);
    } catch (error) {
      this.logger.error(`异步回测任务 ${taskId} 执行失败:`, error);
      await this.updateTaskStatus(taskId, TaskStatus.FAILED, error.message);
      throw error;
    }
  }

  /**
   * 恢复中断的异步回测任务
   */
  async resumeInterruptedTask(taskId: string) {
    const task = await this.asyncBacktestTaskModel.findOne({ taskId }).exec();

    if (!task) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    if (task.status !== TaskStatus.RUNNING) {
      throw new Error(`任务 ${taskId} 状态不是运行中，无法恢复`);
    }

    // 检查是否有中断时间点
    if (!task.currentTime) {
      this.logger.log(`任务 ${taskId} 没有记录中断时间点，从头开始执行`);
      this.executeAsyncVolumeBacktest(taskId).catch(async (error) => {
        this.logger.error(`恢复任务 ${taskId} 执行失败:`, error);
        await this.updateTaskStatus(taskId, TaskStatus.FAILED, error.message);
      });
      return { message: `任务 ${taskId} 已恢复执行（从头开始）` };
    }

    const currentTime = new Date(task.currentTime);
    const endTime = new Date(task.params.endTime);

    this.logger.log(
      `恢复中断的异步回测任务 ${taskId}，从 ${currentTime.toISOString()} 继续到 ${endTime.toISOString()}`,
    );

    // 检查是否已经完成
    if (currentTime >= endTime) {
      this.logger.log(`任务 ${taskId} 已经处理到结束时间，标记为完成`);
      await this.updateTaskStatus(taskId, TaskStatus.COMPLETED);
      return { message: `任务 ${taskId} 已完成` };
    }

    // 从中断点继续执行
    this.resumeAsyncVolumeBacktest(taskId, currentTime).catch(async (error) => {
      this.logger.error(`恢复任务 ${taskId} 执行失败:`, error);
      await this.updateTaskStatus(taskId, TaskStatus.FAILED, error.message);
    });

    return {
      message: `任务 ${taskId} 已恢复执行，从 ${currentTime.toISOString()} 继续`,
      resumeFrom: currentTime.toISOString(),
    };
  }

  /**
   * 清理中断的异步回测任务
   */
  async cleanupInterruptedTask(taskId: string) {
    const task = await this.asyncBacktestTaskModel.findOne({ taskId }).exec();

    if (!task) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    if (task.status !== TaskStatus.RUNNING) {
      throw new Error(`任务 ${taskId} 状态不是运行中，无法清理`);
    }

    await this.updateTaskStatus(
      taskId,
      TaskStatus.FAILED,
      "任务因服务重启而中断",
    );

    return { message: `任务 ${taskId} 已标记为失败` };
  }

  /**
   * 获取所有中断的任务（状态为运行中但实际已停止）
   */
  async getInterruptedTasks() {
    const tasks = await this.asyncBacktestTaskModel
      .find({ status: TaskStatus.RUNNING })
      .sort({ createdAt: -1 })
      .exec();

    return {
      interruptedTasks: tasks.map((task) => ({
        taskId: task.taskId,
        status: task.status,
        currentTime: task.currentTime,
        startedAt: task.startedAt,
        params: {
          startTime: task.params.startTime,
          endTime: task.params.endTime,
          granularityHours: task.params.granularityHours,
        },
      })),
      total: tasks.length,
    };
  }

  /**
   * 批量清理所有中断的任务
   */
  async cleanupAllInterruptedTasks() {
    const result = await this.asyncBacktestTaskModel
      .updateMany(
        { status: TaskStatus.RUNNING },
        {
          $set: {
            status: TaskStatus.FAILED,
            errorMessage: "任务因服务重启而中断",
            completedAt: new Date(),
          },
        },
      )
      .exec();

    this.logger.log(`清理了 ${result.modifiedCount} 个中断的异步回测任务`);

    return {
      message: `已清理 ${result.modifiedCount} 个中断的任务`,
      cleanedCount: result.modifiedCount,
    };
  }

  /**
   * 从中断点恢复异步回测任务
   */
  private async resumeAsyncVolumeBacktest(
    taskId: string,
    resumeTime: Date,
  ): Promise<void> {
    const task = await this.asyncBacktestTaskModel.findOne({ taskId }).exec();
    if (!task) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    // 修改参数：从中断时间点开始
    const modifiedParams = {
      ...task.params,
      startTime: resumeTime.toISOString(),
    };

    const startExecution = Date.now();

    try {
      this.logger.log(
        `从 ${resumeTime.toISOString()} 恢复异步回测任务 ${taskId}`,
      );

      // 创建进度更新函数
      const updateCurrentTime = async (currentTime: Date) => {
        await this.asyncBacktestTaskModel
          .updateOne(
            { taskId },
            { $set: { currentTime: currentTime.toISOString() } },
          )
          .exec();
      };

      // 执行从中断点开始的回测
      const result = await this.executeVolumeBacktestWithTimeTracking(
        modifiedParams,
        updateCurrentTime,
      );

      const processingTime = Date.now() - startExecution;

      // 更新任务状态（不再存储result数据，因为已保存在VolumeBacktest集合中）
      await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, null, {
        processingTimeMs: (task.processingTimeMs || 0) + processingTime,
      });

      this.logger.log(
        `异步回测任务 ${taskId} 恢复完成，本次用时 ${processingTime}ms`,
      );
    } catch (error) {
      this.logger.error(`恢复异步回测任务 ${taskId} 执行失败:`, error);
      await this.updateTaskStatus(taskId, TaskStatus.FAILED, error.message);
      throw error;
    }
  }

  /**
   * 更新任务状态
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    errorMessage?: string,
    updates?: any,
  ): Promise<void> {
    const updateData: any = { status };

    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }

    if (status === TaskStatus.COMPLETED) {
      updateData.completedAt = new Date();
    }

    if (updates) {
      Object.assign(updateData, updates);
    }

    await this.asyncBacktestTaskModel
      .updateOne({ taskId }, { $set: updateData })
      .exec();
  }

  /**
   * 执行成交量排行榜回测 - 带时间追踪的版本
   */
  async executeVolumeBacktestWithTimeTracking(
    params: VolumeBacktestParamsDto,
    timeCallback?: (currentTime: Date) => Promise<void>,
  ): Promise<VolumeBacktestResponse> {
    const startTime = new Date(params.startTime);
    const endTime = new Date(params.endTime);
    const startExecution = Date.now();

    this.logger.log(
      `开始执行成交量回测: ${startTime.toISOString()} - ${endTime.toISOString()}`,
    );

    try {
      // 1. 计算参数
      const granularityHours = params.granularityHours || 8;
      const totalHours = Math.ceil(
        (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60),
      );

      // 2. 获取活跃交易对
      const activeSymbols = params.symbols?.length
        ? params.symbols
        : await this.getActiveSymbols(params);

      this.logger.log(`找到 ${activeSymbols.length} 个活跃交易对`);

      // 3. 获取周期性时间点并使用缓存逻辑筛选交易对
      const weeklyTimes = this.getWeeklySymbolCalculationTimes(
        startTime,
        endTime,
      );

      const weeklySymbolsMap = new Map<string, string[]>();
      let totalValidSymbols = 0;
      let totalInvalidSymbols = 0;

      this.logger.log(
        `📅 回测期间涉及 ${weeklyTimes.length} 个周一时间点，使用缓存逻辑筛选交易对`,
      );

      // 为每个周一时间点分别检查缓存和筛选
      for (const weekStart of weeklyTimes) {
        // 生成该周的筛选条件哈希
        const weeklyFilterHash = this.generateFilterHash(weekStart, params);
        this.logger.log(
          `🔑 周一 ${weekStart.toISOString().slice(0, 10)} 筛选条件哈希: ${weeklyFilterHash.slice(0, 8)}...`,
        );

        let symbolFilter = await this.getFilterFromCache(weeklyFilterHash);

        if (!symbolFilter) {
          // 缓存未命中，使用并发筛选
          this.logger.log(
            `💾 周一 ${weekStart.toISOString().slice(0, 10)} 缓存未命中，启动并发筛选 (${this.CONCURRENCY_CONFIG.GENERAL.maxConcurrency} 并发)...`,
          );
          const concurrentResult = await this.filterSymbolsConcurrently(
            activeSymbols,
            {
              minHistoryDays: params.minHistoryDays || 365,
              requireFutures: true,
              excludeStablecoins: true,
              concurrency: this.CONCURRENCY_CONFIG.GENERAL.maxConcurrency,
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
            activeSymbols,
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
      }

      this.logger.log(`筛选完成，总计: ${totalValidSymbols} 个有效交易对`);

      // 5. 执行回测计算（使用周期性symbols）
      await this.calculateHourlyRankingsWithWeeklySymbolsWithTimeTracking(
        weeklySymbolsMap,
        startTime,
        endTime,
        params,
        timeCallback,
      );

      // 6. 获取结果
      const result = await this.getBacktestResults(startTime, endTime);

      const processingTime = Date.now() - startExecution;

      return {
        success: true,
        granularityHours,
        data: result.map((item) => ({
          timestamp: item.timestamp.toISOString(),
          hour: item.hour,
          rankings: item.rankings,
          removedSymbols: item.removedSymbols || [],
          btcPrice: item.btcPrice,
          btcPriceChange24h: item.btcPriceChange24h,
          btcdomPrice: item.btcdomPrice,
          btcdomPriceChange24h: item.btcdomPriceChange24h,
          marketStats: {
            totalVolume: item.totalMarketVolume,
            totalQuoteVolume: item.totalMarketQuoteVolume,
            topMarketConcentration: 0, // 可以后续计算
          },
          calculationTime: item.calculationDuration || 0,
        })),
        meta: {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          totalHours,
          dataPoints: result.length,
          processingTime,
          symbolStats: {
            totalDiscovered: activeSymbols.length,
            validSymbols: totalValidSymbols,
            invalidSymbols: totalInvalidSymbols,
            validRate:
              ((totalValidSymbols / activeSymbols.length) * 100).toFixed(1) +
              "%",
            filterCriteria: {
              minHistoryDays: params.minHistoryDays || 365,
            },
          },
        },
      };
    } catch (error) {
      this.logger.error("成交量回测执行失败: ", error);
      throw error;
    }
  }

  /**
   * 执行成交量排行榜回测
   */
  async executeVolumeBacktest(
    params: VolumeBacktestParamsDto,
  ): Promise<VolumeBacktestResponse> {
    return this.executeVolumeBacktestWithTimeTracking(params);
  }

  /**
   * 原有的executeVolumeBacktest实现保持不变
   */
  async executeVolumeBacktestOriginal(
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
            `💾 周一 ${weekStart.toISOString().slice(0, 10)} 缓存未命中，启动并发筛选 (${this.CONCURRENCY_CONFIG.GENERAL.maxConcurrency} 并发)...`,
          );
          const concurrentResult = await this.filterSymbolsConcurrently(
            allActiveSymbols,
            {
              minHistoryDays: params.minHistoryDays || 365,
              requireFutures: true,
              excludeStablecoins: true,
              concurrency: this.CONCURRENCY_CONFIG.GENERAL.maxConcurrency,
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
        granularityHours: params.granularityHours, // 回测时间粒度放在外层
        data: results.map((result) => ({
          timestamp: result.timestamp.toISOString(),
          hour: result.hour,
          rankings: result.rankings, // 使用合并后的rankings
          removedSymbols: result.removedSymbols || [], // 从上一期排名中移除的交易对
          btcPrice: result.btcPrice, // 添加BTC价格
          btcPriceChange24h: result.btcPriceChange24h, // 添加BTC价格变化率
          btcdomPrice: result.btcdomPrice, // 添加BTCDOM价格
          btcdomPriceChange24h: result.btcdomPriceChange24h, // 添加BTCDOM价格变化率
          marketStats: {
            totalVolume: result.totalMarketVolume,
            totalQuoteVolume: result.totalMarketQuoteVolume,
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
  ): HourlyRankingItem[] {
    const rankings: HourlyRankingItem[] = [];

    // 1. 首先根据涨跌幅找出交易对
    for (const [symbol, window] of volumeWindows) {
      if (
        window.data &&
        window.data.length >= 24 &&
        window.quoteVolume24h >= minVolumeThreshold
      ) {
        const latestKline = window.data[window.data.length - 1];
        const earliestKline = window.data[0];

        const currentPrice = parseFloat(latestKline.open);
        const price24hAgo = parseFloat(earliestKline.open);

        // 计算24小时涨跌幅
        const priceChange24h =
          price24hAgo !== 0
            ? ((currentPrice - price24hAgo) / price24hAgo) * 100
            : 0;

        // 计算24小时内的最高价和最低价
        let high24h = 0;
        let low24h = Infinity;

        for (const kline of window.data) {
          const high = parseFloat(kline.high);
          const low = parseFloat(kline.low);

          if (high > high24h) {
            high24h = high;
          }
          if (low < low24h) {
            low24h = low;
          }
        }

        // 计算波动率：(最高价 - 最低价) / 最低价 * 100
        const volatility24h =
          low24h !== 0 ? ((high24h - low24h) / low24h) * 100 : 0;

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
          priceChange24h,
          priceAtTime: currentPrice,
          price24hAgo,
          volume24h: window.volume24h,
          quoteVolume24h: window.quoteVolume24h,
          marketShare: 0, // 将在计算总量后设置
          volatility24h,
          high24h,
          low24h,
        });
      }
    }

    // 2. 按涨跌幅排序（跌幅最大的在前）
    rankings.sort((a, b) => a.priceChange24h - b.priceChange24h);

    // 3. 设置排名和市场份额
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
  private calculateMarketStats(rankings: HourlyRankingItem[]) {
    return {
      totalVolume: rankings.reduce((sum, item) => sum + item.volume24h, 0),
      totalQuoteVolume: rankings.reduce(
        (sum, item) => sum + item.quoteVolume24h,
        0,
      ),
    };
  }

  /**
   * 计算市场集中度（前10名份额）
   */
  private calculateMarketConcentration(rankings: HourlyRankingItem[]): number {
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
    granularityHours: number,
  ): Promise<void> {
    try {
      // 在保存前添加资金费率历史数据
      const enrichedResult = await this.addFundingRateHistory(
        result,
        granularityHours,
      );

      // 使用 findOneAndUpdate 来实现 upsert（如果存在则更新，不存在则创建）
      await this.volumeBacktestModel.findOneAndUpdate(
        { timestamp: enrichedResult.timestamp }, // 查找条件
        enrichedResult, // 更新数据
        {
          upsert: true, // 如果不存在则创建
          new: true, // 返回更新后的文档
          overwrite: true, // 完全覆盖现有文档
        },
      );

      this.logger.debug(
        `💾 数据已保存/更新: ${enrichedResult.timestamp.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ 保存数据失败: ${result.timestamp.toISOString()}`,
        error,
      );
      throw error;
    }
  }

  /**
   * 为回测结果添加资金费率历史数据（优化版：一次性获取完整时间范围）
   * @param result 原始回测结果
   * @param granularityHours 时间粒度（小时）
   * @returns 包含资金费率历史的回测结果
   */
  private async addFundingRateHistory(
    result: VolumeBacktest,
    granularityHours: number,
  ): Promise<VolumeBacktest> {
    try {
      // 计算完整时间范围：从当前时间到下一个granularityHours时间点
      const currentTime = result.timestamp.getTime();
      const startTime = currentTime; // 从当前时间开始（包含当前时间点）
      const endTime = currentTime + (granularityHours * 60 * 60 * 1000) + (10 * 60 * 1000); // granularityHours小时后再加10分钟

      // 验证时间计算结果
      if (isNaN(startTime) || isNaN(endTime)) {
        this.logger.error(
          `❌ 时间计算错误: currentTime=${currentTime}, granularityHours=${granularityHours}`,
        );
        return result; // 返回原始结果，不添加资金费率
      }

      this.logger.debug(
        `📊 一次性获取资金费率: ${new Date(startTime).toISOString()} 到 ${new Date(endTime).toISOString()}`,
      );

      // 只收集rankings中的交易对来获取资金费率
      const symbolsArray = result.rankings.map((item) => item.symbol);

      // 一次性批量获取完整时间范围的资金费率数据
      const allFundingRateMap = await this.getFundingRateHistoryBatch(
        symbolsArray,
        startTime,
        endTime,
      );

      // 分离当前资金费率和历史资金费率数据
      const currentFundingRateMap = new Map<string, number>();
      const historyFundingRateMap = new Map<string, FundingRateHistoryItem[]>();
      
      const currentTimeThreshold = currentTime + 10 * 60 * 1000; // 当前时间+10分钟作为分界线

      for (const [symbol, allRates] of allFundingRateMap) {
        // 分离当前和历史数据
        const currentRates = allRates.filter(rate => 
          new Date(rate.fundingTime).getTime() <= currentTimeThreshold
        );
        const historyRates = allRates.filter(rate => 
          new Date(rate.fundingTime).getTime() > currentTimeThreshold
        );

        // 存储历史数据
        historyFundingRateMap.set(symbol, historyRates);

        // 存储当前资金费率（取最新的一个）
        if (currentRates.length > 0) {
          const latestCurrentRate = currentRates[currentRates.length - 1];
          currentFundingRateMap.set(symbol, latestCurrentRate.fundingRate);
        }
      }

      // 为rankings添加资金费率历史
      const rankingsWithHistory = result.rankings.map((item) => ({
        ...item,
        fundingRateHistory: historyFundingRateMap.get(item.symbol) || [],
        currentFundingRate: currentFundingRateMap.get(item.symbol) || undefined,
      }));

      this.logger.debug(
        `✅ 资金费率数据添加完成: 成功获取 ${allFundingRateMap.size}/${symbolsArray.length} 个交易对的数据`,
      );
      this.logger.debug(
        `   📈 当前费率: ${currentFundingRateMap.size} 个，历史费率: ${historyFundingRateMap.size} 个`,
      );

      return {
        ...result,
        rankings: rankingsWithHistory,
        // 保持removedSymbols不变，不添加资金费率历史
        removedSymbols: result.removedSymbols,
      };
    } catch (error) {
      this.logger.error(
        `❌ 添加资金费率历史失败: ${result.timestamp.toISOString()}`,
        error,
      );
      // 如果资金费率获取失败，仍然保存原始数据
      return result;
    }
  }

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
   * 获取移除交易对在指定时间点的数据
   */
  private async getRemovedSymbolsData(
    symbols: string[],
    timestamp: Date,
  ): Promise<HourlyRankingItem[]> {
    const removedSymbolsData: HourlyRankingItem[] = [];

    // 分批处理以避免API限制
    const batchSize = 10;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (symbol) => {
          try {
            // 创建临时的滑动窗口来获取24小时数据
            const volumeWindow: VolumeWindow = {
              symbol,
              data: [],
              volume24h: 0,
              quoteVolume24h: 0,
            };

            // 获取24小时数据窗口
            const windowStart = new Date(
              timestamp.getTime() - 24 * 60 * 60 * 1000,
            );
            const klineData = await this.loadSymbolKlines(
              symbol,
              windowStart,
              timestamp,
            );

            if (klineData && klineData.length > 0) {
              volumeWindow.data = klineData;
              this.updateWindowVolume(volumeWindow);

              // 计算价格和波动率数据
              const latestKline = klineData[klineData.length - 1];
              const earliestKline = klineData[0];

              const priceAtTime = parseFloat(latestKline.open);
              const price24hAgo = parseFloat(earliestKline.open);
              const priceChange24h =
                ((priceAtTime - price24hAgo) / price24hAgo) * 100;

              // 计算24小时最高价和最低价
              const high24h = Math.max(
                ...klineData.map((k) => parseFloat(k.high)),
              );
              const low24h = Math.min(
                ...klineData.map((k) => parseFloat(k.low)),
              );
              const volatility24h = ((high24h - low24h) / low24h) * 100;

              // 提取基础资产和计价资产
              const baseAsset = this.extractBaseAsset(symbol);
              const quoteAsset = symbol.replace(baseAsset, "");

              const symbolData: HourlyRankingItem = {
                rank: 0, // 将在后续设置
                symbol,
                baseAsset,
                quoteAsset,
                priceChange24h,
                priceAtTime,
                price24hAgo,
                volume24h: volumeWindow.volume24h,
                quoteVolume24h: volumeWindow.quoteVolume24h,
                marketShare: 0, // 被移除的交易对市场份额设为0
                volatility24h,
                high24h,
                low24h,
              };

              return symbolData;
            }
            return null;
          } catch (error) {
            this.logger.warn(`⚠️ 获取 ${symbol} 数据失败: ${error.message}`);
            return null;
          }
        }),
      );

      // 处理批次结果
      batchResults.forEach((result) => {
        if (result.status === "fulfilled" && result.value) {
          removedSymbolsData.push(result.value);
        }
      });

      // 批次间延迟
      if (i + batchSize < symbols.length) {
        await this.delay(this.configService.binanceRequestDelay * 2);
      }
    }

    // 添加期货价格到移除的交易对
    try {
      this.logger.debug(
        `🔍 为 ${removedSymbolsData.length} 个移除的交易对添加期货价格...`,
      );
      await this.addFuturesPricesToRankings(removedSymbolsData, timestamp);
    } catch (error) {
      this.logger.warn(
        `⚠️ 为移除交易对添加期货价格失败: ${error.message}，继续使用现货价格`,
      );
    }

    // 按价格跌幅排序（与主排行榜保持一致）
    removedSymbolsData.sort((a, b) => a.priceChange24h - b.priceChange24h);

    // 设置排名
    removedSymbolsData.forEach((item, index) => {
      item.rank = index + 1;
    });

    return removedSymbolsData;
  }

  /**
   * 计算从上一期排名中移除的交易对数据
   * 在实时计算中使用，避免后续补充操作
   */
  private async calculateRemovedSymbols(
    currentTime: Date,
    currentRankings: HourlyRankingItem[],
    params: VolumeBacktestParamsDto,
  ): Promise<HourlyRankingItem[]> {
    try {
      // 计算上一期时间点
      const granularityHours = params.granularityHours || 8;
      const previousTime = new Date(
        currentTime.getTime() - granularityHours * 60 * 60 * 1000,
      );

      // 查询上一期的排名数据
      const previousResult = await this.volumeBacktestModel
        .findOne({ timestamp: previousTime })
        .exec();

      // 如果没有上一期数据，需要实时计算上一期的排名
      if (!previousResult || !previousResult.rankings) {
        this.logger.debug(
          `📊 ${currentTime.toISOString()}: 无上一期数据 (${previousTime.toISOString()})，实时计算上一期排名`,
        );

        // 实时计算上一期排名来获取removedSymbols
        const previousRankings = await this.calculatePreviousPeriodRanking(
          previousTime,
          params,
        );

        if (previousRankings.length === 0) {
          return [];
        }

        // 找出从上一期排名中移除的交易对
        const previousSymbols = new Set(previousRankings.map((r) => r.symbol));
        const currentSymbols = new Set(currentRankings.map((r) => r.symbol));
        const removedSymbolNames = Array.from(previousSymbols).filter(
          (symbol) => !currentSymbols.has(symbol),
        );

        if (removedSymbolNames.length === 0) {
          return [];
        }

        this.logger.debug(
          `🔍 ${currentTime.toISOString()}: 通过实时计算发现 ${removedSymbolNames.length} 个移除的交易对`,
        );

        if (removedSymbolNames.length === 0) {
          return [];
        }

        // 获取这些移除交易对的当前时间点数据
        const removedSymbolsData = await this.getRemovedSymbolsData(
          removedSymbolNames,
          currentTime,
        );

        return removedSymbolsData;
      }

      const previousSymbols = new Set(
        previousResult.rankings.map((r) => r.symbol),
      );
      const currentSymbols = new Set(currentRankings.map((r) => r.symbol));
      const removedSymbolNames = Array.from(previousSymbols).filter(
        (symbol) => !currentSymbols.has(symbol),
      );

      if (removedSymbolNames.length === 0) {
        return [];
      }

      this.logger.debug(
        `🔍 ${currentTime.toISOString()}: 发现 ${removedSymbolNames.length} 个移除的交易对`,
      );

      // 获取这些移除交易对的当前时间点数据
      const removedSymbolsData = await this.getRemovedSymbolsData(
        removedSymbolNames,
        currentTime,
      );

      return removedSymbolsData;
    } catch (error) {
      this.logger.warn(
        `⚠️ 计算removedSymbols失败 (${currentTime.toISOString()}): ${error.message}`,
      );
      return []; // 发生错误时返回空数组，不影响主流程
    }
  }

  private async calculatePreviousPeriodRanking(
    previousTime: Date,
    params: VolumeBacktestParamsDto,
  ): Promise<HourlyRankingItem[]> {
    try {
      this.logger.debug(
        `🔄 实时计算上一期 ${previousTime.toISOString()} 的排名`,
      );

      // 找到上一期时间对应的周一时间点
      const weekStart = this.findMondayForTime(previousTime);
      const weekKey = weekStart.toISOString().slice(0, 10);

      // 获取该周的筛选条件哈希（使用传入的参数）
      const weeklyFilterHash = this.generateFilterHash(weekStart, params);
      const symbolFilter = await this.getFilterFromCache(weeklyFilterHash);

      if (!symbolFilter || symbolFilter.valid.length === 0) {
        this.logger.warn(`⚠️ ${weekKey} 周的交易对列表为空`);
        return [];
      }

      const validSymbols = symbolFilter.valid;
      this.logger.debug(
        `📊 使用 ${validSymbols.length} 个交易对计算上一期排名`,
      );

      // 创建临时的滑动窗口
      const volumeWindows = new Map<string, VolumeWindow>();

      // 初始化每个交易对的窗口
      for (const symbol of validSymbols) {
        volumeWindows.set(symbol, {
          symbol,
          data: [],
          volume24h: 0,
          quoteVolume24h: 0,
        });
      }

      // 预加载24小时数据窗口
      const windowStart = new Date(
        previousTime.getTime() - 24 * 60 * 60 * 1000,
      );
      await this.preloadVolumeWindows(
        volumeWindows,
        windowStart,
        previousTime,
        {
          maxConcurrency: this.CONCURRENCY_CONFIG.KLINE_LOADING.maxConcurrency,
          batchSize: this.CONCURRENCY_CONFIG.KLINE_LOADING.batchSize,
        },
      );

      // 计算排行榜
      let rankings = this.calculateRankings(
        volumeWindows,
        params.limit || 50,
        params.minVolumeThreshold || 0,
      );

      // 添加期货价格到上一期排名
      try {
        this.logger.debug(
          `🔍 为上一期 ${rankings.length} 个交易对添加期货价格...`,
        );
        rankings = await this.addFuturesPricesToRankings(
          rankings,
          previousTime,
        );
      } catch (error) {
        this.logger.warn(
          `⚠️ 为上一期排名添加期货价格失败: ${error.message}，继续使用现货价格`,
        );
      }

      this.logger.debug(`✅ 成功计算上一期排名: ${rankings.length} 个交易对`);

      return rankings;
    } catch (error) {
      this.logger.error(
        `❌ 计算上一期排名失败 (${previousTime.toISOString()}): ${error.message}`,
      );
      return [];
    }
  }

  /**
   * 获取指定交易对在特定时间点的期货价格
   */
  private async getFuturesPricesForSymbols(
    symbols: string[],
    timestamp: Date,
    futuresSymbols: Set<string>,
  ): Promise<{ [symbol: string]: number }> {
    const result: { [symbol: string]: number } = {};

    // 过滤出有期货合约的交易对
    const availableSymbols = symbols.filter((symbol) =>
      futuresSymbols.has(symbol),
    );

    if (availableSymbols.length === 0) {
      this.logger.debug(
        `⚠️ 没有找到有期货合约的交易对 (总共 ${symbols.length} 个)`,
      );
      return result;
    }

    this.logger.debug(
      `🔍 获取 ${availableSymbols.length}/${symbols.length} 个交易对的期货价格 (时间: ${timestamp.toISOString()})`,
    );

    // 分批获取期货价格，避免API限制
    const batchSize = this.CONCURRENCY_CONFIG.GENERAL.batchSize;
    for (let i = 0; i < availableSymbols.length; i += batchSize) {
      const batch = availableSymbols.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (symbol) => {
          try {
            // 获取该时间点的期货K线数据，使用更宽的时间范围
            const futuresKlines = await this.binanceService.getFuturesKlines({
              symbol,
              interval: "1h",
              startTime: timestamp.getTime() - 30 * 60 * 1000, // -30分钟
              endTime: timestamp.getTime() + 90 * 60 * 1000, // +90分钟
              limit: 3,
            });

            if (futuresKlines.length > 0) {
              // 找到最接近目标时间的K线
              let closestKline = futuresKlines[0];
              let minTimeDiff = Math.abs(
                futuresKlines[0].openTime - timestamp.getTime(),
              );

              for (const kline of futuresKlines) {
                const timeDiff = Math.abs(kline.openTime - timestamp.getTime());
                if (timeDiff < minTimeDiff) {
                  minTimeDiff = timeDiff;
                  closestKline = kline;
                }
              }

              const price = parseFloat(closestKline.open);
              // this.logger.debug(`💰 ${symbol}: 期货价格 $${price.toFixed(2)} (时间差: ${Math.round(minTimeDiff / 60000)}分钟)`);
              return { symbol, price };
            } else {
              this.logger.warn(
                `⚠️ ${symbol} 在 ${timestamp.toISOString()} 无期货K线数据`,
              );
              return null;
            }
          } catch (error) {
            this.logger.warn(
              `⚠️ 获取 ${symbol} 期货价格失败: ${error.message}`,
            );
            return null;
          }
        }),
      );

      // 处理批次结果
      batchResults.forEach((promiseResult) => {
        if (promiseResult.status === "fulfilled" && promiseResult.value) {
          const { symbol, price } = promiseResult.value;
          result[symbol] = price;
        }
      });

      // 批次间延迟，避免API限流
      if (i + batchSize < availableSymbols.length) {
        await this.delay(300);
      }
    }

    this.logger.debug(
      `✅ 成功获取 ${Object.keys(result).length} 个交易对的期货价格`,
    );
    return result;
  }

  /**
   * 为排名结果添加期货价格信息
   */
  private async addFuturesPricesToRankings(
    rankings: HourlyRankingItem[],
    timestamp: Date,
    futuresSymbols?: Set<string>,
  ): Promise<HourlyRankingItem[]> {
    if (rankings.length === 0) {
      return rankings;
    }

    try {
      // 如果没有提供期货合约列表，则获取
      if (!futuresSymbols) {
        const futuresInfo = await this.binanceService.getFuturesExchangeInfo();
        futuresSymbols = new Set<string>(
          futuresInfo.symbols
            .filter(
              (s: any) =>
                s.status === "TRADING" && s.contractType === "PERPETUAL",
            )
            .map((s: any) => s.symbol),
        );
      }

      // 为每个ranking项设置futureSymbol并准备期货symbols列表
      const futureSymbolsToQuery: string[] = [];
      const symbolToFutureSymbolMap: { [key: string]: string } = {};

      for (const ranking of rankings) {
        // 使用binanceService的映射方法获取期货symbol
        const futureSymbol = await this.binanceService.mapToFuturesSymbol(
          ranking.symbol,
        );
        if (futureSymbol) {
          ranking.futureSymbol =
            futureSymbol !== ranking.symbol ? futureSymbol : undefined;
          futureSymbolsToQuery.push(futureSymbol);
          symbolToFutureSymbolMap[ranking.symbol] = futureSymbol;
        }
      }

      // 获取期货价格（使用实际的期货symbol）
      const futuresPrices = await this.getFuturesPricesForSymbols(
        futureSymbolsToQuery,
        timestamp,
        futuresSymbols,
      );

      // 为每个排名项添加期货价格
      rankings.forEach((ranking) => {
        const futureSymbol = symbolToFutureSymbolMap[ranking.symbol];
        if (futureSymbol) {
          ranking.futurePriceAtTime = futuresPrices[futureSymbol] || undefined;
        }
      });

      const withFuturesCount = rankings.filter(
        (r) => r.futurePriceAtTime !== undefined,
      ).length;
      this.logger.debug(
        `✅ 成功为 ${withFuturesCount}/${rankings.length} 个交易对添加期货价格`,
      );

      return rankings;
    } catch (error) {
      this.logger.warn(
        `⚠️ 添加期货价格失败: ${error.message}，继续使用现货价格`,
      );
      return rankings;
    }
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 获取指定时间段内的资金费率历史
   * @param symbol 交易对符号 (如 BTCUSDT)
   * @param startTime 开始时间戳 (ms)
   * @param endTime 结束时间戳 (ms)
   * @returns 资金费率历史数组
   */
  private async getFundingRateHistory(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<FundingRateHistoryItem[]> {
    try {
      // 验证时间参数
      if (isNaN(startTime) || isNaN(endTime)) {
        this.logger.error(
          `❌ 无效的时间参数: ${symbol}, startTime=${startTime}, endTime=${endTime}`,
        );
        return [];
      }

      if (startTime >= endTime) {
        this.logger.warn(
          `⚠️ 开始时间不能大于等于结束时间: ${symbol}, startTime=${startTime}, endTime=${endTime}`,
        );
        return [];
      }

      // 获取对应的期货交易对
      const futuresSymbol =
        await this.binanceService.mapToFuturesSymbol(symbol);
      if (!futuresSymbol) {
        this.logger.warn(
          `⚠️ ${symbol} 没有对应的期货合约，但却在rankings中出现了！这可能是缓存问题或过滤逻辑问题`,
        );
        return [];
      }

      const data: FundingRateData[] =
        await this.binanceService.getFundingRateHistory({
          symbol: futuresSymbol,
          startTime,
          endTime,
          limit: 1000,
        });

      // 确保 data 是数组
      if (!Array.isArray(data)) {
        this.logger.error(`⚠️ ${symbol} 资金费率历史返回非数组数据:`, data);
        return [];
      }

      return data.map((item) => {
        let markPrice = null;
        
        // 优先使用API返回的markPrice
        if (item.markPrice !== undefined && item.markPrice !== null) {
          const parsedMarkPrice = parseFloat(item.markPrice.toString());
          if (!isNaN(parsedMarkPrice) && parsedMarkPrice > 0) {
            markPrice = parsedMarkPrice;
          }
        }
        
        // 如果markPrice无效，记录警告但仍保存数据
        if (markPrice === null) {
          this.logger.warn(
            `⚠️ ${symbol} 在 ${new Date(item.fundingTime).toISOString()} 没有有效的markPrice，将影响盈亏计算准确性`
          );
        }

        return {
          fundingTime: new Date(item.fundingTime),
          fundingRate: parseFloat(item.fundingRate.toString()),
          markPrice: markPrice, // 可能为null
        };
      });
    } catch (error) {
      this.logger.error(`❌ 获取资金费率历史失败: ${symbol}`, error);
      return [];
    }
  }

  /**
   * 批量获取多个交易对的资金费率历史
   * @param symbols 交易对数组
   * @param startTime 开始时间戳 (ms)
   * @param endTime 结束时间戳 (ms)
   * @returns 资金费率历史映射 (symbol -> FundingRateHistoryItem[])
   */
  private async getFundingRateHistoryBatch(
    symbols: string[],
    startTime: number,
    endTime: number,
  ): Promise<Map<string, FundingRateHistoryItem[]>> {
    const fundingRateMap = new Map<string, FundingRateHistoryItem[]>();

    // 验证时间参数
    if (isNaN(startTime) || isNaN(endTime)) {
      this.logger.error(
        `❌ 批量获取资金费率时无效的时间参数: startTime=${startTime}, endTime=${endTime}`,
      );
      return fundingRateMap;
    }

    if (startTime >= endTime) {
      this.logger.warn(
        `⚠️ 批量获取资金费率时开始时间不能大于等于结束时间: startTime=${startTime}, endTime=${endTime}`,
      );
      return fundingRateMap;
    }

    // 由于资金费率API有严格的频率限制(500/5min/IP)，我们使用更保守的方式
    // 采用分批处理，每批之间有延迟
    const batchSize = this.CONCURRENCY_CONFIG.FUNDING_RATE.batchSize;
    const batches = [];

    for (let i = 0; i < symbols.length; i += batchSize) {
      batches.push(symbols.slice(i, i + batchSize));
    }

    this.logger.debug(
      `📊 分${batches.length}批获取资金费率，每批${batchSize}个交易对`,
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      // 批次间延迟，避免触发API限制
      if (i > 0) {
        await this.delay(2000); // 2秒延迟
      }

      const { results } = await this.processConcurrentlyWithPool(
        batch,
        async (symbol: string) => {
          const history = await this.getFundingRateHistory(
            symbol,
            startTime,
            endTime,
          );
          return { symbol, history };
        },
        {
          maxConcurrency: this.CONCURRENCY_CONFIG.FUNDING_RATE.maxConcurrency,
          retryFailedItems: true,
          maxRetries: 2,
        },
      );

      for (const [, result] of results) {
        if (result && result.history) {
          fundingRateMap.set(result.symbol, result.history);
        }
      }

      this.logger.debug(
        `📊 批次${i + 1}/${batches.length}完成，累计成功: ${fundingRateMap.size}个`,
      );
    }

    this.logger.debug(
      `📊 批量获取资金费率完成: ${symbols.length}个交易对, 成功: ${fundingRateMap.size}个`,
    );
    return fundingRateMap;
  }

  /**
   * 测试期货API连通性
   */
  async testFuturesApi(): Promise<any> {
    return await this.binanceService.testFuturesConnectivity();
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
   * 检查是否为BTC交易对
   */
  private isBtcPair(symbol: string): boolean {
    const baseAsset = this.extractBaseAsset(symbol);
    return baseAsset === "BTC";
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
    const requireFutures = params.requireFutures || true;
    const excludeStablecoins = params.excludeStablecoins ?? true;
    const referenceTime = params.referenceTime || new Date();

    this.logger.log(
      `🚀 筛选交易对: ${symbols.length} 个 | 最少历史: ${minHistoryDays}天${requireFutures ? " | 需要期货合约" : ""}${excludeStablecoins ? " | 排除稳定币" : ""} | 排除BTC`,
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
          `📅 期货检查完成: ${withFutures}/${symbols.length} 个有永续合约`,
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

        // 检查2: 排除BTC
        if (isValid && this.isBtcPair(symbol)) {
          reasons.push("BTC交易对");
          isValid = false;
        }

        // 检查3: 期货合约要求
        if (requireFutures && !futuresAvailability[symbol]) {
          reasons.push("无永续合约");
          isValid = false;
        }

        // 检查4: 历史数据要求
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

        // 简化进度日志 - 每50个输出一次
        if (
          processedCount.value % 50 === 0 ||
          processedCount.value === symbols.length
        ) {
          const progress = (
            (processedCount.value / symbols.length) *
            100
          ).toFixed(1);
          this.logger.log(
            `⏳ 筛选进度: ${processedCount.value}/${symbols.length} (${progress}%)`,
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
      `✅ 筛选完成: ${validSymbols.length}/${symbols.length} (${((validSymbols.length / symbols.length) * 100).toFixed(1)}%) 通过筛选`,
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

    // 找到startTime对应或之前的最近周一0点(UTC)
    while (current.getDay() !== 1) {
      current.setDate(current.getDate() - 1);
    }
    // 设置为周一0点
    current.setHours(0, 0, 0, 0);

    this.logger.log(
      `📅 从 ${current.toISOString().slice(0, 10)} 开始计算周一时间点`,
    );

    // 从找到的周一开始，每周添加一个时间点，直到超过endTime
    while (current <= endTime) {
      weeklyTimes.push(new Date(current));
      current.setDate(current.getDate() + 7); // 加7天到下一个周一
    }

    this.logger.log(
      `📊 共计算出 ${weeklyTimes.length} 个周一时间点: ${weeklyTimes.map((d) => d.toISOString().slice(0, 10)).join(", ")}`,
    );

    return weeklyTimes;
  }

  /**
   * 使用周期性Symbols排行榜计算指定粒度的排行榜（默认8小时） - 带时间追踪版本
   */
  private async calculateHourlyRankingsWithWeeklySymbolsWithTimeTracking(
    weeklySymbolsMap: Map<string, string[]>,
    startTime: Date,
    endTime: Date,
    params: VolumeBacktestParamsDto,
    timeCallback?: (currentTime: Date) => Promise<void>,
  ): Promise<void> {
    const granularityMs = (params.granularityHours || 8) * 60 * 60 * 1000;
    const currentTime = new Date(startTime.getTime());
    let processedCount = 0;
    const totalPeriods = Math.ceil(
      (endTime.getTime() - startTime.getTime()) / granularityMs,
    );

    this.logger.log(
      `🚀 开始周期性Symbols排行榜计算，共 ${totalPeriods} 个时间点，粒度 ${params.granularityHours || 8} 小时`,
    );

    while (currentTime < endTime) {
      try {
        // 更新当前处理时间
        if (timeCallback) {
          await timeCallback(new Date(currentTime.getTime()));
        }

        // 找到当前时间对应的周一0点
        const weekStart = this.findMondayForTime(currentTime);
        const weekKey = weekStart.toISOString().slice(0, 10);
        const symbols = weeklySymbolsMap.get(weekKey) || [];

        if (symbols.length === 0) {
          this.logger.warn(
            `⚠️ 时间点 ${currentTime.toISOString()} 对应的周一 ${weekKey} 没有找到符合条件的交易对，跳过`,
          );
          currentTime.setTime(currentTime.getTime() + granularityMs);
          continue;
        }

        // 计算该时间点的排行榜
        await this.calculateSinglePeriodRanking(currentTime, symbols, params);

        processedCount++;

        // 每处理5个时间点输出一次进度
        if (processedCount % 5 === 0) {
          const progress = ((processedCount / totalPeriods) * 100).toFixed(1);
          this.logger.log(
            `📈 计算进度: ${processedCount}/${totalPeriods} (${progress}%) - 当前时间: ${currentTime.toISOString()}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `❌ 计算时间点 ${currentTime.toISOString()} 的排行榜失败:`,
          error,
        );
        // 继续处理下一个时间点
      }

      currentTime.setTime(currentTime.getTime() + granularityMs);
    }

    this.logger.log(
      `✅ 周期性symbols计算完成，共处理 ${processedCount}/${totalPeriods} 个时间点`,
    );
  }

  /**
   * 使用周期性Symbols排行榜计算指定粒度的排行榜（默认8小时）
   */
  private async calculateHourlyRankingsWithWeeklySymbols(
    weeklySymbolsMap: Map<string, string[]>,
    startTime: Date,
    endTime: Date,
    params: VolumeBacktestParamsDto,
  ): Promise<void> {
    const granularityMs = (params.granularityHours || 8) * 60 * 60 * 1000; // 添加默认值防护
    const currentTime = new Date(startTime.getTime());
    let processedCount = 0;
    const totalPeriods = Math.ceil(
      (endTime.getTime() - startTime.getTime()) / granularityMs,
    );

    this.logger.log(
      `🚀 开始周期性Symbols排行榜计算，共 ${totalPeriods} 个时间点，粒度 ${params.granularityHours || 8} 小时`,
    );

    while (currentTime < endTime) {
      try {
        // 找到当前时间对应的周一0点
        const weekStart = this.findMondayForTime(currentTime);
        const weekKey = weekStart.toISOString().slice(0, 10);
        const symbols = weeklySymbolsMap.get(weekKey) || [];

        if (symbols.length === 0) {
          this.logger.warn(
            `⚠️ 时间点 ${currentTime.toISOString()} 对应的周一 ${weekKey} 没有找到符合条件的交易对，跳过`,
          );
          currentTime.setTime(currentTime.getTime() + granularityMs);
          continue;
        }

        // 计算该时间点的排行榜
        await this.calculateSinglePeriodRanking(currentTime, symbols, params);

        processedCount++;

        // 每处理10个时间点输出一次进度
        if (processedCount % 10 === 0) {
          const progress = ((processedCount / totalPeriods) * 100).toFixed(1);
          this.logger.log(
            `📈 进度: ${processedCount}/${totalPeriods} (${progress}%)`,
          );
        }
      } catch (error) {
        this.logger.error(
          `❌ 计算时间点 ${currentTime.toISOString()} 的排行榜失败:`,
          error,
        );
        // 继续处理下一个时间点
      }

      currentTime.setTime(currentTime.getTime() + granularityMs);
    }

    this.logger.log(
      `✅ 周期性symbols计算完成，共处理 ${processedCount}/${totalPeriods} 个时间点`,
    );
  }

  /**
   * 找到指定时间对应的周一0点(UTC)
   */
  private findMondayForTime(time: Date): Date {
    const monday = new Date(time.getTime());

    // 向前找到周一
    while (monday.getDay() !== 1) {
      monday.setDate(monday.getDate() - 1);
    }

    // 设置为0点
    monday.setHours(0, 0, 0, 0);

    return monday;
  }

  /**
   * 计算单个时间点的排行榜
   */
  private async calculateSinglePeriodRanking(
    currentTime: Date,
    symbols: string[],
    params: VolumeBacktestParamsDto,
  ): Promise<void> {
    const periodStart = Date.now();
    // 显示当前计算的交易对信息
    const symbolsInfo =
      symbols.length <= 15
        ? `[${symbols.join(", ")}]`
        : `[${symbols.slice(0, 8).join(", ")}, ...+${symbols.length - 8}个]`;
    this.logger.log(
      `📊 计算 ${currentTime.toISOString()} 排行榜: ${symbolsInfo}`,
    );

    try {
      // 创建临时的滑动窗口
      const volumeWindows = new Map<string, VolumeWindow>();

      // 初始化每个交易对的窗口
      for (const symbol of symbols) {
        volumeWindows.set(symbol, {
          symbol,
          data: [],
          volume24h: 0,
          quoteVolume24h: 0,
        });
      }

      // 预加载24小时数据窗口
      const windowStart = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);
      await this.preloadVolumeWindows(volumeWindows, windowStart, currentTime, {
        maxConcurrency: this.CONCURRENCY_CONFIG.KLINE_LOADING.maxConcurrency,
        batchSize: this.CONCURRENCY_CONFIG.KLINE_LOADING.batchSize,
      });

      // 获取BTC现货价格和24小时前价格（带重试机制）
      let btcPrice = 0;
      let btcPriceChange24h = 0;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // 一次性获取过去25小时的BTC价格数据（包含当前小时和24小时前）
          const btc25hAgoTime = currentTime.getTime() - 25 * 60 * 60 * 1000;
          const btcKlines = await this.binanceService.getKlines({
            symbol: "BTCUSDT",
            interval: "1h",
            startTime: btc25hAgoTime,
            endTime: currentTime.getTime() + 60 * 60 * 1000, // +1小时
            limit: 26, // 获取26个小时的数据，确保覆盖所需时间范围
          });

          if (btcKlines && btcKlines.length >= 2) {
            // 最新的K线是当前价格，倒数第25个（如果有的话）是24小时前的价格
            const currentKline = btcKlines[btcKlines.length - 1]; // 最新价格
            const target24hAgoTime =
              currentTime.getTime() - 24 * 60 * 60 * 1000;

            // 找到最接近24小时前的K线数据
            let btc24hAgoKline = null;
            let minTimeDiff = Math.abs(
              btcKlines[0].openTime - target24hAgoTime,
            );

            for (const kline of btcKlines) {
              const timeDiff = Math.abs(kline.openTime - target24hAgoTime);
              if (timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                btc24hAgoKline = kline;
              }
            }

            if (currentKline && btc24hAgoKline) {
              btcPrice = parseFloat(currentKline.open);
              const btcPrice24hAgo = parseFloat(btc24hAgoKline.open);

              if (btcPrice24hAgo > 0) {
                btcPriceChange24h =
                  ((btcPrice - btcPrice24hAgo) / btcPrice24hAgo) * 100;
                this.logger.debug(
                  `📈 BTC价格变化 (${currentTime.toISOString()}): $${btcPrice.toFixed(2)} (24h: ${btcPriceChange24h > 0 ? "+" : ""}${btcPriceChange24h.toFixed(2)}%)`,
                );
              } else {
                this.logger.warn(
                  `⚠️ BTC 24小时前价格数据异常: ${btcPrice24hAgo}`,
                );
                btcPriceChange24h = 0;
              }

              break; // 成功获取，跳出重试循环
            } else {
              this.logger.warn(`⚠️ 无法从K线数据中提取有效的BTC价格信息`);
            }
          } else {
            this.logger.warn(
              `⚠️ 无法获取足够的BTC价格历史数据: ${currentTime.toISOString()} (尝试 ${attempt}/${maxRetries})`,
            );
          }
        } catch (error) {
          const isLastAttempt = attempt === maxRetries;
          if (isLastAttempt) {
            this.logger.error(
              `❌ 获取BTC价格最终失败 (已重试${maxRetries}次): ${error.message}`,
            );
            // 如果获取BTC价格失败，继续执行，但价格设为0
            btcPrice = 0;
            btcPriceChange24h = 0;
          } else {
            this.logger.warn(
              `⚠️ 获取BTC价格失败，正在重试 (${attempt}/${maxRetries}): ${error.message}`,
            );
            // 等待后重试
            await this.delay(1000 * attempt); // 1s, 2s, 3s递增延迟
          }
        }
      }

      // 获取BTCDOM合约价格和24小时前价格（带重试机制）
      let btcdomPrice = 0;
      let btcdomPriceChange24h = 0;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // 一次性获取过去25小时的BTCDOM价格数据（包含当前小时和24小时前）
          const btcdom25hAgoTime = currentTime.getTime() - 25 * 60 * 60 * 1000;
          const btcdomKlines = await this.binanceService.getFuturesKlines({
            symbol: "BTCDOMUSDT",
            interval: "1h",
            startTime: btcdom25hAgoTime,
            endTime: currentTime.getTime() + 60 * 60 * 1000, // +1小时
            limit: 26, // 获取26个小时的数据，确保覆盖所需时间范围
          });

          if (btcdomKlines && btcdomKlines.length >= 2) {
            // 最新的K线是当前价格，倒数第25个（如果有的话）是24小时前的价格
            const currentKline = btcdomKlines[btcdomKlines.length - 1]; // 最新价格
            const target24hAgoTime =
              currentTime.getTime() - 24 * 60 * 60 * 1000;

            // 找到最接近24小时前的K线数据
            let btcdom24hAgoKline = null;
            let minTimeDiff = Math.abs(
              btcdomKlines[0].openTime - target24hAgoTime,
            );

            for (const kline of btcdomKlines) {
              const timeDiff = Math.abs(kline.openTime - target24hAgoTime);
              if (timeDiff < minTimeDiff) {
                minTimeDiff = timeDiff;
                btcdom24hAgoKline = kline;
              }
            }

            if (currentKline && btcdom24hAgoKline) {
              btcdomPrice = parseFloat(currentKline.open);
              const btcdomPrice24hAgo = parseFloat(btcdom24hAgoKline.open);

              if (btcdomPrice24hAgo > 0) {
                btcdomPriceChange24h =
                  ((btcdomPrice - btcdomPrice24hAgo) / btcdomPrice24hAgo) * 100;
                this.logger.debug(
                  `📈 BTCDOM价格变化 (${currentTime.toISOString()}): ${btcdomPrice.toFixed(2)} (24h: ${btcdomPriceChange24h > 0 ? "+" : ""}${btcdomPriceChange24h.toFixed(2)}%)`,
                );
              } else {
                this.logger.warn(
                  `⚠️ BTCDOM 24小时前价格数据异常: ${btcdomPrice24hAgo}`,
                );
                btcdomPriceChange24h = 0;
              }

              break; // 成功获取，跳出重试循环
            } else {
              this.logger.warn(`⚠️ 无法从K线数据中提取有效的BTCDOM价格信息`);
              // 重试
            }
          } else {
            this.logger.warn(
              `⚠️ 无BTCDOM价格历史数据: ${currentTime.toISOString()}`,
            );
            // 数据不足通常是历史时间太早，不需要重试
            break;
          }
        } catch (error) {
          const isLastAttempt = attempt === maxRetries;
          if (isLastAttempt) {
            this.logger.error(
              `❌ 获取BTCDOM价格最终失败 (已重试${maxRetries}次): ${error.message}`,
            );
            // 如果获取BTCDOM价格失败，继续执行，但价格设为0
            btcdomPrice = 0;
            btcdomPriceChange24h = 0;
          } else {
            this.logger.warn(
              `⚠️ 获取BTCDOM价格失败，正在重试 (${attempt}/${maxRetries}): ${error.message}`,
            );
            // 等待后重试
            await this.delay(1000 * attempt); // 1s, 2s, 3s递增延迟
          }
        }
      }

      // 计算合并排行榜（按涨跌幅排序，跌幅最大的在前）
      let rankings = this.calculateRankings(
        volumeWindows,
        params.limit || 50,
        params.minVolumeThreshold || 0,
      );

      // 添加期货价格到排名
      try {
        this.logger.debug(`🔍 为 ${rankings.length} 个交易对添加期货价格...`);
        rankings = await this.addFuturesPricesToRankings(rankings, currentTime);
      } catch (error) {
        this.logger.warn(
          `⚠️ 添加期货价格失败: ${error.message}，继续使用现货价格`,
        );
      }

      // 计算市场统计
      const marketStats = this.calculateMarketStats(rankings);

      // 计算 removedSymbols（从上一期排名中移除的交易对）
      const removedSymbols = await this.calculateRemovedSymbols(
        currentTime,
        rankings,
        params,
      );

      // 保存结果
      if (rankings.length > 0) {
        await this.saveSingleBacktestResult(
          {
            timestamp: currentTime,
            hour: currentTime.getUTCHours(), // 使用UTC时间的小时数
            rankings: rankings, // 使用合并后的rankings
            removedSymbols: removedSymbols, // 实时计算的removedSymbols
            totalMarketVolume: marketStats.totalVolume,
            totalMarketQuoteVolume: marketStats.totalQuoteVolume,
            btcPrice, // 添加BTC价格
            btcPriceChange24h, // 添加BTC价格变化率
            btcdomPrice, // 添加BTCDOM价格
            btcdomPriceChange24h, // 添加BTCDOM价格变化率
            calculationDuration: Date.now() - periodStart,
            createdAt: new Date(),
          },
          params.granularityHours,
        );

        this.logger.log(`💾 ${currentTime.toISOString()} 排行榜已保存:`);
        this.logger.log(
          `   📈 BTC价格: $${btcPrice.toFixed(2)} (24h: ${btcPriceChange24h > 0 ? "+" : ""}${btcPriceChange24h.toFixed(2)}%)`,
        );
        this.logger.log(
          `   📊 BTCDOM价格: ${btcdomPrice.toFixed(2)} (24h: ${btcdomPriceChange24h > 0 ? "+" : ""}${btcdomPriceChange24h.toFixed(2)}%)`,
        );
        this.logger.log(
          `   📉 跌幅前3名: ${rankings
            .slice(0, 3)
            .map((r) => `${r.symbol}(${r.priceChange24h.toFixed(2)}%)`)
            .join(", ")}`,
        );
        if (removedSymbols.length > 0) {
          this.logger.log(
            `   🗑️ 移除交易对: ${removedSymbols.length}个 [${removedSymbols
              .slice(0, 3)
              .map((r) => `${r.symbol}(${r.priceChange24h.toFixed(2)}%)`)
              .join(", ")}${removedSymbols.length > 3 ? "..." : ""}]`,
          );
        }
      } else {
        this.logger.warn(
          `⚠️ ${currentTime.toISOString()} 没有生成有效的排行榜数据`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ 计算时间点 ${currentTime.toISOString()} 排行榜失败:`,
        error,
      );
      throw error;
    }
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
      maxConcurrency = this.CONCURRENCY_CONFIG.GENERAL.maxConcurrency * 2, // 通用最大并发的2倍
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
          await this.delay(Math.pow(2, attempt) * 1000); // 指数退避
          return processItem(item, attempt + 1);
        } else {
          errors.set(item, error as Error);
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

    this.logger.debug(
      `✅ 处理完成: ${metrics.processed}/${items.length} 成功${metrics.failed > 0 ? `, ${metrics.failed} 失败` : ""}`,
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
      maxConcurrency = this.CONCURRENCY_CONFIG.GENERAL.maxConcurrency,
      enableAdaptiveThrottling = true,
      retryFailed = true,
    } = options;

    const symbolsInfo =
      symbols.length <= 10
        ? `[${symbols.join(", ")}]`
        : `[${symbols.slice(0, 5).join(", ")}, ...+${symbols.length - 5}个]`;
    this.logger.log(`📊 加载K线数据 ${symbolsInfo}`);

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
    const failedSymbols = symbols.filter(
      (symbol) => finalResults.get(symbol) === null,
    );

    if (failedSymbols.length === 0) {
      this.logger.log(`✅ 全部成功: ${successCount}/${symbols.length}`);
    } else {
      const failedInfo =
        failedSymbols.length <= 3
          ? `[${failedSymbols.join(", ")}]`
          : `[${failedSymbols.slice(0, 2).join(", ")}, ...${failedSymbols.length - 2}个]`;
      this.logger.log(
        `⚠️ 部分失败: ${successCount}/${symbols.length} 成功, 失败 ${failedInfo}`,
      );
    }

    return finalResults;
  }

  /**
   * 预加载数据 - 并发优化版本
   */
  private async preloadVolumeWindows(
    volumeWindows: Map<string, VolumeWindow>,
    startTime: Date,
    endTime: Date,
    options: {
      maxConcurrency?: number;
      batchSize?: number;
    } = {},
  ): Promise<void> {
    const {
      maxConcurrency = this.CONCURRENCY_CONFIG.GENERAL.maxConcurrency,
      batchSize = this.CONCURRENCY_CONFIG.GENERAL.batchSize,
    } = options;
    const symbols = Array.from(volumeWindows.keys());

    this.logger.log(`🔄 开始并发预加载 ${symbols.length} 个交易对的数据窗口`);

    // 分批处理以避免内存压力
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchInfo =
        batch.length <= 5
          ? `[${batch.join(", ")}]`
          : `[${batch.slice(0, 3).join(", ")}, ...+${batch.length - 3}个]`;
      this.logger.log(
        `   📦 批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(symbols.length / batchSize)}: 加载 ${batchInfo}`,
      );

      const klineResults = await this.loadKlinesBatchOptimized(
        batch,
        startTime,
        endTime,
        { maxConcurrency, retryFailed: true },
      );

      // 更新数据窗口，并移除没有数据的symbol
      for (const [symbol, klineData] of klineResults) {
        const window = volumeWindows.get(symbol);
        if (window && klineData && klineData.length > 0) {
          window.data = klineData;
          this.updateWindowVolume(window);
        } else {
          // 如果没有获取到kline数据，从volumeWindows中移除该symbol
          this.logger.warn(
            `⚠️ ${symbol} 在时间段 ${startTime.toISOString()} - ${endTime.toISOString()} 没有kline数据，已从排行榜中排除`,
          );
          volumeWindows.delete(symbol);
        }
      }

      // 批次间短暂暂停，避免API压力
      if (i + batchSize < symbols.length) {
        await this.delay(500);
      }
    }

    const validSymbolsCount = volumeWindows.size;
    const removedSymbolsCount = symbols.length - validSymbolsCount;

    if (removedSymbolsCount > 0) {
      this.logger.log(
        `✅ 预加载完成: ${validSymbolsCount}/${symbols.length} 个数据窗口已初始化，${removedSymbolsCount} 个交易对因无数据被排除`,
      );
    } else {
      this.logger.debug(
        `✅ 预加载完成: ${validSymbolsCount} 个数据窗口已初始化`,
      );
    }
  }

  /**
   * 补充现有数据中缺失的BTCDOM价格信息
   * @param startTime 开始时间
   * @param endTime 结束时间
   * @returns 更新结果
   */
  async supplementBtcdomPrices(
    startTime?: Date,
    endTime?: Date,
  ): Promise<{
    success: boolean;
    updated: number;
    skipped: number;
    failed: number;
    message: string;
  }> {
    const start = Date.now();
    this.logger.log('🔄 开始补充BTCDOM价格数据...');

    try {
      // 构建查询条件：查找没有BTCDOM价格的记录
      const query: any = {
        $or: [
          { btcdomPrice: { $exists: false } },
          { btcdomPrice: null },
          { btcdomPriceChange24h: { $exists: false } },
          { btcdomPriceChange24h: null },
        ],
      };

      if (startTime && endTime) {
        // 如果同时提供了开始和结束时间，使用闭区间查询
        query.timestamp = { $gte: startTime, $lte: endTime };
      } else if (startTime) {
        // 只有开始时间，查询大于等于开始时间的记录
        query.timestamp = { $gte: startTime };
      } else if (endTime) {
        // 只有结束时间，查询小于等于结束时间的记录
        query.timestamp = { $lte: endTime };
      }
      // 如果都没有提供，则查询所有缺失BTCDOM价格的记录

      // 获取需要补充的记录
      const recordsToUpdate = await this.volumeBacktestModel
        .find(query)
        .sort({ timestamp: 1 })
        .exec();

      if (recordsToUpdate.length === 0) {
        return {
          success: true,
          updated: 0,
          skipped: 0,
          failed: 0,
          message: '没有需要补充BTCDOM价格的记录',
        };
      }

      this.logger.log(`📋 找到 ${recordsToUpdate.length} 条需要补充BTCDOM价格的记录`);

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      // 批量处理记录
      for (const record of recordsToUpdate) {
        try {
          const currentTime = record.timestamp;
          
          // 获取BTCDOM价格
          const { btcdomPrice, btcdomPriceChange24h } = await this.fetchBtcdomPrice(currentTime);

          if (btcdomPrice > 0) {
            // 更新记录
            await this.volumeBacktestModel.updateOne(
              { _id: record._id },
              {
                $set: {
                  btcdomPrice,
                  btcdomPriceChange24h,
                },
              },
            );
            updated++;
            
            if (updated % 10 === 0) {
              this.logger.log(`📈 已更新 ${updated}/${recordsToUpdate.length} 条记录`);
            }
          } else {
            this.logger.warn(`⚠️ 无法获取 ${currentTime.toISOString()} 的BTCDOM价格`);
            skipped++;
          }

          // 添加延迟避免API限制
          if (updated % 5 === 0) {
            await this.delay(1000);
          }
        } catch (error) {
          this.logger.error(`❌ 更新记录失败 ${record.timestamp.toISOString()}: ${error.message}`);
          failed++;
        }
      }

      const duration = Date.now() - start;
      const message = `BTCDOM价格补充完成: 更新 ${updated} 条，跳过 ${skipped} 条，失败 ${failed} 条，耗时 ${(duration / 1000).toFixed(2)}s`;
      
      this.logger.log(`✅ ${message}`);

      return {
        success: true,
        updated,
        skipped,
        failed,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ 补充BTCDOM价格失败: ${error.message}`);
      return {
        success: false,
        updated: 0,
        skipped: 0,
        failed: 0,
        message: `补充失败: ${error.message}`,
      };
    }
  }

  /**
   * 获取指定时间的BTCDOM价格信息
   * @param currentTime 当前时间
   * @returns BTCDOM价格和变化率
   */
  private async fetchBtcdomPrice(currentTime: Date): Promise<{
    btcdomPrice: number;
    btcdomPriceChange24h: number;
  }> {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 获取过去25小时的BTCDOM价格数据
        const btcdom25hAgoTime = currentTime.getTime() - 25 * 60 * 60 * 1000;
        const btcdomKlines = await this.binanceService.getFuturesKlines({
          symbol: "BTCDOMUSDT",
          interval: "1h",
          startTime: btcdom25hAgoTime,
          endTime: currentTime.getTime() + 60 * 60 * 1000,
          limit: 26,
        });

        if (btcdomKlines && btcdomKlines.length >= 2) {
          const currentKline = btcdomKlines[btcdomKlines.length - 1];
          const target24hAgoTime = currentTime.getTime() - 24 * 60 * 60 * 1000;

          // 找到最接近24小时前的K线数据
          let btcdom24hAgoKline = null;
          let minTimeDiff = Math.abs(
            btcdomKlines[0].openTime - target24hAgoTime,
          );

          for (const kline of btcdomKlines) {
            const timeDiff = Math.abs(kline.openTime - target24hAgoTime);
            if (timeDiff < minTimeDiff) {
              minTimeDiff = timeDiff;
              btcdom24hAgoKline = kline;
            }
          }

          if (currentKline && btcdom24hAgoKline) {
            const btcdomPrice = parseFloat(currentKline.open);
            const btcdomPrice24hAgo = parseFloat(btcdom24hAgoKline.open);

            let btcdomPriceChange24h = 0;
            if (btcdomPrice24hAgo > 0) {
              btcdomPriceChange24h = ((btcdomPrice - btcdomPrice24hAgo) / btcdomPrice24hAgo) * 100;
            }

            return { btcdomPrice, btcdomPriceChange24h };
          }
        }

        // 如果不是最后一次尝试，等待后重试
        if (attempt < maxRetries) {
          await this.delay(1000 * attempt);
        }
      } catch (error) {
        if (attempt === maxRetries) {
          this.logger.warn(`⚠️ 获取BTCDOM价格失败 (${currentTime.toISOString()}): ${error.message}`);
        }
      }
    }

    return { btcdomPrice: 0, btcdomPriceChange24h: 0 };
  }

  /**
   * 获取最新的回测记录 - 优化查询性能
   */
  async getLatestBacktestResult(): Promise<VolumeBacktest | null> {
    return this.volumeBacktestModel
      .findOne()
      .sort({ timestamp: -1 }) // 按时间倒序排列，获取最新的一条
      .exec();
  }

  /**
   * 补充往期缺失的currentFundingRate字段
   */
  async backfillCurrentFundingRate(
    startTime?: Date,
    endTime?: Date
  ): Promise<{
    success: boolean;
    processed: number;
    updated: number;
    message: string;
  }> {
    try {
      this.logger.log('开始补充往期缺失的currentFundingRate字段');

      // 构建查询条件
      const query: any = {};
      if (startTime && endTime) {
        query.timestamp = { $gte: startTime, $lte: endTime };
      } else if (startTime) {
        query.timestamp = { $gte: startTime };
      } else if (endTime) {
        query.timestamp = { $lte: endTime };
      }

      // 查询需要补充的记录
      const records = await this.volumeBacktestModel
        .find(query)
        .sort({ timestamp: 1 })
        .exec();

      if (records.length === 0) {
        return {
          success: true,
          processed: 0,
          updated: 0,
          message: '没有找到需要处理的记录',
        };
      }

      this.logger.log(`找到 ${records.length} 条记录需要处理`);

      let processed = 0;
      let updated = 0;

      for (const record of records) {
        try {
          processed++;

          // 为每个ranking项补充currentFundingRate
          const updatedRankings = await this.addCurrentFundingRateToRankings(
            record.rankings,
            record.timestamp,
          );

          // 更新数据库记录
          await this.volumeBacktestModel.findByIdAndUpdate(
            record._id,
            { rankings: updatedRankings },
            { new: true },
          );

          updated++;
          
          if (processed % 10 === 0) {
            this.logger.log(`进度: ${processed}/${records.length} (已更新: ${updated})`);
          }

          // 添加小延迟避免过于频繁的API调用
          await this.delay(200);

        } catch (error) {
          this.logger.error(`处理记录失败 (${record.timestamp.toISOString()}):`, error);
        }
      }

      const message = `处理完成: 处理 ${processed} 条记录, 成功更新 ${updated} 条`;
      this.logger.log(message);

      return {
        success: true,
        processed,
        updated,
        message,
      };

    } catch (error) {
      this.logger.error('补充currentFundingRate失败:', error);
      throw error;
    }
  }

  /**
   * 为ranking项添加currentFundingRate字段（优化版：使用统一的批量获取）
   */
  private async addCurrentFundingRateToRankings(
    rankings: any[],
    timestamp: Date,
  ): Promise<any[]> {
    try {
      // 收集所有需要查询资金费率的symbols
      const symbolsToQuery: string[] = [];
      const symbolToFutureSymbolMap: { [key: string]: string } = {};

      for (const ranking of rankings) {
        const futureSymbol = await this.binanceService.mapToFuturesSymbol(ranking.symbol);
        if (futureSymbol) {
          symbolsToQuery.push(futureSymbol);
          symbolToFutureSymbolMap[ranking.symbol] = futureSymbol;
        }
      }

      if (symbolsToQuery.length === 0) {
        return rankings;
      }

      // 获取当期时间点的资金费率（优化：使用更大的批次大小）
      const currentTime = timestamp.getTime();
      const startTime = currentTime;
      const endTime = currentTime + 10 * 60 * 1000; // 10分钟后

      this.logger.debug(
        `获取当期资金费率: ${new Date(startTime).toISOString()} 到 ${new Date(endTime).toISOString()}`,
      );

      // 使用优化的批量获取方法（批次大小调整为10，减少分批次数）
      const fundingRateMap = await this.getFundingRateHistoryBatch(
        symbolsToQuery,
        startTime,
        endTime,
      );

      // 为每个ranking项添加currentFundingRate
      const updatedRankings = rankings.map((ranking) => {
        const futureSymbol = symbolToFutureSymbolMap[ranking.symbol];
        if (futureSymbol) {
          const currentFundingRates = fundingRateMap.get(futureSymbol);
          if (currentFundingRates && currentFundingRates.length > 0) {
            // 取最新的一条资金费率记录
            const latestFunding = currentFundingRates[currentFundingRates.length - 1];
            return {
              ...ranking,
              currentFundingRate: latestFunding.fundingRate,
            };
          }
        }
        return ranking;
      });

      return updatedRankings;

    } catch (error) {
      this.logger.error('添加currentFundingRate失败:', error);
      return rankings;
    }
  }

  /**
   * 启动异步补充currentFundingRate任务
   */
  startAsyncBackfillCurrentFundingRate(
    startTime?: Date,
    endTime?: Date,
    batchSize: number = 50,
  ): string {
    const taskId = `backfill-funding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.logger.log(`启动异步补充currentFundingRate任务: ${taskId}`);

    // 在后台执行任务，不阻塞当前请求
    setImmediate(async () => {
      try {
        await this.executeOptimizedAsyncBackfillCurrentFundingRate(
          taskId,
          startTime,
          endTime,
          batchSize,
        );
      } catch (error) {
        this.logger.error(`异步补充任务 ${taskId} 执行失败:`, error);
      }
    });

    return taskId;
  }

  /**
   * 执行异步补充currentFundingRate任务
   */
  private async executeAsyncBackfillCurrentFundingRate(
    taskId: string,
    startTime?: Date,
    endTime?: Date,
    batchSize: number = 50,
  ): Promise<void> {
    const startExecutionTime = Date.now();
    this.logger.log(`开始执行异步补充任务 ${taskId}`);

    try {
      // 构建查询条件
      const query: any = {};
      if (startTime && endTime) {
        query.timestamp = { $gte: startTime, $lte: endTime };
      } else if (startTime) {
        query.timestamp = { $gte: startTime };
      } else if (endTime) {
        query.timestamp = { $lte: endTime };
      }

      // 计算总记录数
      const totalRecords = await this.volumeBacktestModel.countDocuments(query);
      this.logger.log(`任务 ${taskId}: 找到 ${totalRecords} 条记录需要处理`);

      if (totalRecords === 0) {
        this.logger.log(`任务 ${taskId}: 没有找到需要处理的记录`);
        return;
      }

      let processed = 0;
      let updated = 0;
      let batchCount = 0;
      const totalBatches = Math.ceil(totalRecords / batchSize);

      // 分批处理
      while (processed < totalRecords) {
        batchCount++;
        
        const records = await this.volumeBacktestModel
          .find(query)
          .sort({ timestamp: 1 })
          .skip(processed)
          .limit(batchSize)
          .exec();

        if (records.length === 0) {
          break;
        }

        this.logger.log(`任务 ${taskId}: 处理第 ${batchCount}/${totalBatches} 批 (${records.length} 条记录)`);

        for (const record of records) {
          try {
            // 为每个ranking项补充currentFundingRate
            const updatedRankings = await this.addCurrentFundingRateToRankings(
              record.rankings,
              record.timestamp,
            );

            // 更新数据库记录
            await this.volumeBacktestModel.findByIdAndUpdate(
              record._id,
              { rankings: updatedRankings },
              { new: true },
            );

            updated++;

          } catch (error) {
            this.logger.error(`任务 ${taskId}: 处理记录失败 (${record.timestamp.toISOString()}):`, error);
          }

          processed++;
        }

        // 批次间添加短暂延迟，避免过度占用资源
        await this.delay(500);

        // 定期报告进度
        const progressPercent = Math.round((processed / totalRecords) * 100);
        this.logger.log(`任务 ${taskId}: 进度 ${processed}/${totalRecords} (${progressPercent}%, 已更新: ${updated})`);
      }

      const executionTime = Date.now() - startExecutionTime;
      const message = `任务 ${taskId} 完成: 处理 ${processed} 条记录, 成功更新 ${updated} 条, 耗时 ${Math.round(executionTime / 1000)}秒`;
      this.logger.log(message);

    } catch (error) {
      const executionTime = Date.now() - startExecutionTime;
      this.logger.error(`任务 ${taskId} 执行失败 (耗时 ${Math.round(executionTime / 1000)}秒):`, error);
      throw error;
    }
  }

  /**
   * 优化版：执行异步补充currentFundingRate任务
   * 主要优化：
   * 1. 预构建symbol映射缓存
   * 2. 资金费率时间窗口缓存
   * 3. 批量数据库更新
   * 4. 并发处理优化
   */
  private async executeOptimizedAsyncBackfillCurrentFundingRate(
    taskId: string,
    startTime?: Date,
    endTime?: Date,
    batchSize: number = 50,
  ): Promise<void> {
    const startExecutionTime = Date.now();
    this.logger.log(`开始执行优化版异步补充任务 ${taskId}`);

    try {
      // 构建查询条件
      const query: any = {};
      if (startTime && endTime) {
        query.timestamp = { $gte: startTime, $lte: endTime };
      } else if (startTime) {
        query.timestamp = { $gte: startTime };
      } else if (endTime) {
        query.timestamp = { $lte: endTime };
      }

      // 计算总记录数
      const totalRecords = await this.volumeBacktestModel.countDocuments(query);
      this.logger.log(`任务 ${taskId}: 找到 ${totalRecords} 条记录需要处理`);

      if (totalRecords === 0) {
        this.logger.log(`任务 ${taskId}: 没有找到需要处理的记录`);
        return;
      }

      // 步骤1：预构建symbol映射缓存
      this.logger.log(`任务 ${taskId}: 步骤1 - 构建symbol映射缓存`);
      const symbolMappingCache = await this.buildSymbolMappingCache(query);
      this.logger.log(`任务 ${taskId}: symbol映射缓存构建完成，共 ${symbolMappingCache.size} 个映射`);

      // 步骤2：分批处理记录
      let processed = 0;
      let updated = 0;
      const totalBatches = Math.ceil(totalRecords / batchSize);
      const fundingRateCache = new Map<string, Map<string, FundingRateHistoryItem[]>>();

      this.logger.log(`任务 ${taskId}: 步骤2 - 开始分批处理，共 ${totalBatches} 批`);

      while (processed < totalRecords) {
        const batchNumber = Math.floor(processed / batchSize) + 1;

        const records = await this.volumeBacktestModel
          .find(query)
          .sort({ timestamp: 1 })
          .skip(processed)
          .limit(batchSize)
          .exec();

        if (records.length === 0) {
          break;
        }

        this.logger.log(`任务 ${taskId}: 处理第 ${batchNumber}/${totalBatches} 批 (${records.length} 条记录)`);

        // 批量处理当前批次的记录
        const batchUpdated = await this.processBatchRecordsOptimized(
          records,
          symbolMappingCache,
          fundingRateCache,
          taskId,
        );

        updated += batchUpdated;
        processed += records.length;

        // 进度报告
        if (batchNumber % 10 === 0 || batchNumber === totalBatches) {
          const progress = ((processed / totalRecords) * 100).toFixed(1);
          this.logger.log(`任务 ${taskId}: 进度 ${progress}% (${processed}/${totalRecords}), 已更新 ${updated} 条`);
        }

        // 批次间短暂延迟，避免过度占用资源
        if (processed < totalRecords) {
          await this.delay(100);
        }
      }

      const executionTime = Date.now() - startExecutionTime;
      this.logger.log(`任务 ${taskId} 完成: 处理 ${processed}/${totalRecords} 条记录, 更新 ${updated} 条, 耗时 ${executionTime}ms`);
      this.logger.log(`任务 ${taskId}: 平均每条记录耗时 ${(executionTime / processed).toFixed(2)}ms`);

    } catch (error) {
      this.logger.error(`任务 ${taskId} 执行失败:`, error);
      throw error;
    }
  }

  /**
   * 构建symbol映射缓存
   */
  private async buildSymbolMappingCache(query: any): Promise<Map<string, string>> {
    const symbolMappingCache = new Map<string, string>();

    // 获取所有需要处理的记录中的unique symbols
    const uniqueSymbols = new Set<string>();

    // 分批获取记录以避免内存问题
    const batchSize = 100;
    let skip = 0;

    while (true) {
      const records = await this.volumeBacktestModel
        .find(query, { rankings: 1 })
        .skip(skip)
        .limit(batchSize)
        .exec();

      if (records.length === 0) {
        break;
      }

      // 收集所有symbols
      for (const record of records) {
        for (const ranking of record.rankings) {
          uniqueSymbols.add(ranking.symbol);
        }
      }

      skip += batchSize;
    }

    this.logger.log(`发现 ${uniqueSymbols.size} 个unique symbols，开始构建映射缓存`);

    // 批量获取symbol映射
    const symbolsArray = Array.from(uniqueSymbols);
    const mappingBatchSize = 50;

    for (let i = 0; i < symbolsArray.length; i += mappingBatchSize) {
      const batch = symbolsArray.slice(i, i + mappingBatchSize);

      // 并发获取映射
      const mappingPromises = batch.map(async (symbol) => {
        try {
          const futureSymbol = await this.binanceService.mapToFuturesSymbol(symbol);
          return { symbol, futureSymbol };
        } catch (error) {
          this.logger.warn(`获取 ${symbol} 映射失败:`, error);
          return { symbol, futureSymbol: null };
        }
      });

      const mappingResults = await Promise.all(mappingPromises);

      // 存储映射结果
      for (const result of mappingResults) {
        if (result.futureSymbol) {
          symbolMappingCache.set(result.symbol, result.futureSymbol);
        }
      }

      // 批次间延迟
      if (i + mappingBatchSize < symbolsArray.length) {
        await this.delay(100);
      }
    }

    return symbolMappingCache;
  }

  /**
   * 批量处理记录（优化版）
   */
  private async processBatchRecordsOptimized(
    records: any[],
    symbolMappingCache: Map<string, string>,
    fundingRateCache: Map<string, Map<string, FundingRateHistoryItem[]>>,
    taskId: string,
  ): Promise<number> {
    const bulkOperations = [];
    let updated = 0;

    for (const record of records) {
      try {
        // 获取当前记录的时间窗口key
        const timeWindowKey = this.getTimeWindowKey(record.timestamp);

        // 检查缓存中是否已有该时间窗口的资金费率数据
        if (!fundingRateCache.has(timeWindowKey)) {
          // 为该时间窗口获取资金费率数据
          await this.loadFundingRateForTimeWindow(
            record,
            symbolMappingCache,
            fundingRateCache,
            timeWindowKey,
          );
        }

        // 使用缓存的资金费率数据更新rankings
        const updatedRankings = this.addCurrentFundingRateFromCache(
          record.rankings,
          symbolMappingCache,
          fundingRateCache.get(timeWindowKey),
        );

        // 检查是否有实际更新
        const hasUpdates = this.hasCurrentFundingRateUpdates(record.rankings, updatedRankings);

        if (hasUpdates) {
          // 添加到批量更新操作
          bulkOperations.push({
            updateOne: {
              filter: { _id: record._id },
              update: { $set: { rankings: updatedRankings } },
            },
          });
          updated++;
        }

      } catch (error) {
        this.logger.error(`任务 ${taskId}: 处理记录失败 (${record.timestamp.toISOString()}):`, error);
      }
    }

    // 执行批量更新
    if (bulkOperations.length > 0) {
      try {
        await this.volumeBacktestModel.bulkWrite(bulkOperations);
        this.logger.debug(`任务 ${taskId}: 批量更新 ${bulkOperations.length} 条记录成功`);
      } catch (error) {
        this.logger.error(`任务 ${taskId}: 批量更新失败:`, error);
      }
    }

    return updated;
  }

  /**
   * 获取时间窗口key（用于缓存）
   */
  private getTimeWindowKey(timestamp: Date): string {
    // 使用8小时为窗口，确保相同时间窗口的记录使用相同的资金费率数据
    const hours = Math.floor(timestamp.getTime() / (8 * 60 * 60 * 1000));
    return `window_${hours}`;
  }

  /**
   * 为时间窗口加载资金费率数据
   */
  private async loadFundingRateForTimeWindow(
    record: any,
    symbolMappingCache: Map<string, string>,
    fundingRateCache: Map<string, Map<string, FundingRateHistoryItem[]>>,
    timeWindowKey: string,
  ): Promise<void> {
    try {
      // 收集该记录中需要查询的symbols
      const symbolsToQuery: string[] = [];

      for (const ranking of record.rankings) {
        const futureSymbol = symbolMappingCache.get(ranking.symbol);
        if (futureSymbol && !symbolsToQuery.includes(futureSymbol)) {
          symbolsToQuery.push(futureSymbol);
        }
      }

      if (symbolsToQuery.length === 0) {
        fundingRateCache.set(timeWindowKey, new Map());
        return;
      }

      // 计算查询时间范围
      const currentTime = record.timestamp.getTime();
      const startTime = currentTime - 8 * 60 * 60 * 1000; // 8小时前
      const endTime = currentTime + 8 * 60 * 60 * 1000;   // 8小时后

      // 批量获取资金费率
      const fundingRateMap = await this.getFundingRateHistoryBatch(
        symbolsToQuery,
        startTime,
        endTime,
      );

      // 分离当前和历史资金费率
      const timeWindowData = new Map<string, FundingRateHistoryItem[]>();
      const currentTimeThreshold = currentTime + 10 * 60 * 1000; // 当前时间+10分钟

      for (const [symbol, allRates] of fundingRateMap) {
        const currentRates = allRates.filter(rate =>
          new Date(rate.fundingTime).getTime() <= currentTimeThreshold
        );
        timeWindowData.set(symbol, currentRates);
      }

      fundingRateCache.set(timeWindowKey, timeWindowData);

    } catch (error) {
      this.logger.error(`加载时间窗口 ${timeWindowKey} 资金费率失败:`, error);
      fundingRateCache.set(timeWindowKey, new Map());
    }
  }

  /**
   * 从缓存中添加currentFundingRate
   */
  private addCurrentFundingRateFromCache(
    rankings: any[],
    symbolMappingCache: Map<string, string>,
    timeWindowData?: Map<string, FundingRateHistoryItem[]>,
  ): any[] {
    if (!timeWindowData) {
      return rankings;
    }

    return rankings.map((ranking) => {
      const futureSymbol = symbolMappingCache.get(ranking.symbol);
      if (futureSymbol) {
        const currentFundingRates = timeWindowData.get(futureSymbol);
        if (currentFundingRates && currentFundingRates.length > 0) {
          // 取最新的一条资金费率记录
          const latestFunding = currentFundingRates[currentFundingRates.length - 1];
          return {
            ...ranking,
            currentFundingRate: latestFunding.fundingRate,
          };
        }
      }
      return ranking;
    });
  }

  /**
   * 检查是否有currentFundingRate更新
   */
  private hasCurrentFundingRateUpdates(originalRankings: any[], updatedRankings: any[]): boolean {
    for (let i = 0; i < originalRankings.length; i++) {
      const original = originalRankings[i];
      const updated = updatedRankings[i];

      // 检查是否添加了新的currentFundingRate字段
      if (!original.currentFundingRate && updated.currentFundingRate !== undefined) {
        return true;
      }

      // 检查currentFundingRate是否有变化
      if (original.currentFundingRate !== updated.currentFundingRate) {
        return true;
      }
    }

    return false;
  }
}
