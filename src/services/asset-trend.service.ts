import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { AssetTrend } from "../models/asset-trend.model";
import { GliTrendPeriod } from "../models/gli-trend.model";
import { TradingViewService } from "./tradingview.service";
import { BenchmarkAsset, BenchmarkService } from "./benchmark.service";
import { GliService } from "./gli.service";

// 数据可用性状态
enum DataAvailabilityStatus {
  AVAILABLE = "available", // 数据可用
  TOO_EARLY = "too_early", // 资产在该时间点还不存在
  REQUEST_FAILED = "req_failed", // 请求失败（网络错误、服务器错误等）
  RATE_LIMITED = "rate_limited", // 请求被限流
}

@Injectable()
export class AssetTrendService {
  private readonly logger = new Logger(AssetTrendService.name);

  constructor(
    @InjectModel("AssetTrend")
    private readonly assetTrendModel: Model<AssetTrend>,
    private readonly tradingViewService: TradingViewService,
    private readonly benchmarkService: BenchmarkService,
    private readonly gliService: GliService,
  ) {}

  /**
   * 获取所有资产在各趋势期间的表现数据
   * @param trendType 趋势类型（'centralBank' 或 'm2'）
   */
  public async getAllAssetTrends(
    trendType: "centralBank" | "m2" = "centralBank",
  ): Promise<AssetTrend[]> {
    try {
      const trends = await this.assetTrendModel
        .find({ trendType })
        .sort({ category: 1, assetName: 1 });
      return trends;
    } catch (error) {
      this.logger.error(`获取资产${trendType}趋势表现数据失败`, error);
      throw new Error(`获取资产${trendType}趋势表现数据失败`);
    }
  }

  /**
   * 获取单个资产在各趋势期间的表现数据
   * @param assetId 资产ID
   * @param trendType 趋势类型（'centralBank' 或 'm2'）
   */
  public async getAssetTrend(
    assetId: string,
    trendType: "centralBank" | "m2" = "centralBank",
  ): Promise<AssetTrend | null> {
    try {
      const trend = await this.assetTrendModel.findOne({ assetId, trendType });
      return trend;
    } catch (error) {
      this.logger.error(
        `获取资产 ${assetId} 的${trendType}趋势表现数据失败`,
        error,
      );
      throw new Error(`获取资产 ${assetId} 的${trendType}趋势表现数据失败`);
    }
  }

  /**
   * 临时计算资产在特定滞后天数下的趋势表现，不更新数据库
   * @param assetId 资产ID
   * @param intervalType 时间间隔类型（如'1D', '1W', '1M'）
   * @param intervalCount 时间间隔数量
   * @param trendType 趋势类型（'centralBank' 或 'm2'）
   */
  public async updateAssetLagDays(
    assetId: string,
    intervalType: string,
    intervalCount: number,
    trendType: "centralBank" | "m2" = "centralBank",
  ): Promise<AssetTrend | null> {
    try {
      // 获取资产信息
      const assets = await this.getBenchmarkAssets();
      const asset = assets.find((a) => a.id === assetId);

      if (!asset) {
        throw new Error(`未找到ID为 ${assetId} 的资产`);
      }

      // 将时间间隔转换为天数
      let lagDays = 0;
      switch (intervalType) {
        case "1D":
          lagDays = intervalCount; // 日线，直接使用天数
          break;
        case "1W":
          lagDays = intervalCount * 7; // 周线，乘以7
          break;
        case "1M":
          lagDays = intervalCount * 30; // 月线，粗略估计为30天
          break;
        default:
          lagDays = intervalCount; // 默认情况
      }

      // 根据趋势类型获取趋势期间
      const trendPeriods =
        trendType === "centralBank"
          ? this.gliService.centralBankTrendPeriods
          : this.gliService.m2TrendPeriods;

      // 临时创建一个带有新lagDays的资产对象，不修改原始资产
      const tempAsset = { ...asset, lagDays };

      // 使用临时资产对象计算趋势表现
      const assetTrend = await this.calculateAssetTrend(
        tempAsset,
        trendPeriods,
        trendType,
      );

      this.logger.log(
        `已临时计算资产 ${asset.name} 在 ${lagDays} 天滞后下的 ${trendType} 趋势表现（不更新数据库）`,
      );

      // 返回计算结果，但不写入数据库
      return {
        ...assetTrend,
        // 添加标记，表示这是临时计算的结果和趋势类型
        temporary: true,
        trendType,
      } as AssetTrend;
    } catch (error) {
      this.logger.error(
        `计算资产 ${assetId} 在特定滞后天数下的趋势表现失败`,
        error,
      );
      throw new Error(
        `计算资产 ${assetId} 在特定滞后天数下的趋势表现失败: ${error.message}`,
      );
    }
  }

  /**
   * 计算并存储所有资产在各趋势期间的表现
   * @param forceUpdate 是否强制更新（可选，默认为false）
   */
  public async calculateAndStoreAllAssetTrends(forceUpdate: boolean = false): Promise<AssetTrend[]> {
    try {
      // 如果是强制更新，先删除所有现有的趋势数据
      if (forceUpdate) {
        console.log("强制更新模式：删除所有现有的资产趋势数据...");
        await this.assetTrendModel.deleteMany({});
        console.log("已删除所有现有的资产趋势数据");
      }

      console.log("\n开始获取趋势期间数据...");
      // 获取所有趋势期间
      const centralBankTrendPeriods = this.gliService.centralBankTrendPeriods;
      const m2TrendPeriods = this.gliService.m2TrendPeriods;
      console.log(
        `成功获取 ${centralBankTrendPeriods.length} 个央行趋势期间和 ${m2TrendPeriods.length} 个M2趋势期间`,
      );

      console.log("开始获取对比标的数据...");
      // 获取所有对比标的
      const assets = await this.getBenchmarkAssets();
      console.log(`成功获取 ${assets.length} 个对比标的`);

      // 计算每个资产在每个趋势期间的表现
      const results: AssetTrend[] = [];

      // 创建进度跟踪器
      // let processedAssets = 0;
      const totalAssets = assets.length;
      console.log(`\n开始处理 ${totalAssets} 个资产的趋势数据...`);

      console.log("\n开始顺序处理资产数据...");

      for (let index = 0; index < assets.length; index++) {
        const asset = assets[index];
        const startTime = Date.now();
        console.log(
          `\n[资产 ${index + 1}/${totalAssets}] 开始处理: ${asset.name} (${asset.symbol})`,
        );

        try {
          // 处理央行趋势
          console.log(
            `  获取 ${asset.name} 的央行趋势数据 (共 ${centralBankTrendPeriods.length} 个趋势期间)...`,
          );
          const centralBankTrend = await this.calculateAssetTrend(
            asset,
            centralBankTrendPeriods,
            "centralBank",
          );

          // 处理M2趋势
          console.log(
            `  获取 ${asset.name} 的M2趋势数据 (共 ${m2TrendPeriods.length} 个趋势期间)...`,
          );
          const m2Trend = await this.calculateAssetTrend(
            asset,
            m2TrendPeriods,
            "m2",
          );

          // 统计央行趋势数据状态
          const centralBankStatusCounts: Record<string, number> = {};
          centralBankTrend.performances.forEach((perf) => {
            if (perf.dataStatus) {
              centralBankStatusCounts[perf.dataStatus] =
                (centralBankStatusCounts[perf.dataStatus] || 0) + 1;
            }
          });

          // 统计M2趋势数据状态
          const m2StatusCounts: Record<string, number> = {};
          m2Trend.performances.forEach((perf) => {
            if (perf.dataStatus) {
              m2StatusCounts[perf.dataStatus] =
                (m2StatusCounts[perf.dataStatus] || 0) + 1;
            }
          });

          // 打印央行趋势数据状态统计
          console.log("  央行趋势数据状态统计:");
          Object.entries(centralBankStatusCounts).forEach(([status, count]) => {
            const statusSymbol =
              status === DataAvailabilityStatus.AVAILABLE
                ? "✓"
                : status === DataAvailabilityStatus.TOO_EARLY
                  ? "⌛"
                  : status === DataAvailabilityStatus.RATE_LIMITED
                    ? "⚠"
                    : "❗";
            console.log(`    ${statusSymbol} ${status}: ${count} 个期间`);
          });

          // 打印M2趋势数据状态统计
          console.log("  M2趋势数据状态统计:");
          Object.entries(m2StatusCounts).forEach(([status, count]) => {
            const statusSymbol =
              status === DataAvailabilityStatus.AVAILABLE
                ? "✓"
                : status === DataAvailabilityStatus.TOO_EARLY
                  ? "⌛"
                  : status === DataAvailabilityStatus.RATE_LIMITED
                    ? "⚠"
                    : "❗";
            console.log(`    ${statusSymbol} ${status}: ${count} 个期间`);
          });

          // 存储央行趋势数据到数据库
          console.log(`  存储 ${asset.name} 的央行趋势数据到数据库...`);
          const centralBankResult = await this.assetTrendModel.findOneAndUpdate(
            { assetId: asset.id, trendType: "centralBank" },
            { ...centralBankTrend, trendType: "centralBank" },
            { upsert: true, new: true },
          );

          // 存储M2趋势数据到数据库
          console.log(`  存储 ${asset.name} 的M2趋势数据到数据库...`);
          const m2Result = await this.assetTrendModel.findOneAndUpdate(
            { assetId: asset.id, trendType: "m2" },
            { ...m2Trend, trendType: "m2" },
            { upsert: true, new: true },
          );

          // 计算处理时间
          const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(
            `  ✓ 完成 ${asset.name} 的处理 (耗时: ${processingTime}s)`,
          );

          // 更新进度
          // processedAssets++;
          results.push(centralBankResult, m2Result);

          // 在处理下一个资产前等待1秒，避免请求过快
          if (index < assets.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          this.logger.error(`处理资产 ${asset.name} 的趋势数据失败`, error);
          console.log(
            `  ❗ 错误: 处理 ${asset.name} 失败 - ${error.message || String(error)}`,
          );

          // 更新进度
          // processedAssets++;
          // 继续处理下一个资产
        }
      }

      console.log(
        `处理完成! 成功处理了 ${results.length / 2}/${totalAssets} 个资产的趋势数据`,
      );

      return results;
    } catch (error) {
      this.logger.error("计算并存储资产趋势表现数据失败", error);
      throw new Error("计算并存储资产趋势表现数据失败");
    }
  }

  /**
   * 计算单个资产在各趋势期间的表现
   * @param asset 资产对象，包含id、name、symbol、category和lagDays属性
   * @param trendPeriods 趋势期间数组
   * @param trendType 趋势类型（'centralBank' 或 'm2'）
   */
  private async calculateAssetTrend(
    asset: BenchmarkAsset,
    trendPeriods: GliTrendPeriod[],
    trendType: "centralBank" | "m2" = "centralBank",
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
          lastUpdated: new Date(),
          trendType,
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

      // 考虑资产的lagDays属性，调整时间范围
      // 如果lagDays为正，表示对比标的滞后GLI，需要向后移动时间窗口
      // 如果lagDays为正，表示对比标的领先GLI，需要向后移动时间窗口
      const lagDaysMs = (asset.lagDays || 0) * 24 * 60 * 60 * 1000; // 转换为毫秒
      earliestStartDate += lagDaysMs;
      latestEndDate += lagDaysMs;

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
          lastUpdated: new Date(),
          trendType,
        };
      }

      try {
        // 转换为秒级时间戳
        const fromTimestampSec = Math.floor(earliestStartDate / 1000);
        const toTimestampSec = Math.floor(latestEndDate / 1000);

        // 使用分批获取方法获取所有需要的K线数据
        const allCandles = await this.fetchKlineDataInBatches(
          asset.id,
          "1D", // 使用日线数据计算涨跌幅
          fromTimestampSec,
          toTimestampSec,
        );

        // 如果没有获取到数据，返回错误
        if (allCandles.length === 0) {
          // 处理所有未处理的期间
          for (const period of trendPeriods) {
            const periodId = `${period.startDate}_${period.endDate}`;
            // 检查是否已经处理过该期间
            if (!performances.some((p) => p.periodId === periodId)) {
              performances.push({
                periodId,
                startDate: period.startDate,
                endDate: period.endDate,
                change: 0,
                dataStatus: DataAvailabilityStatus.TOO_EARLY,
                statusMessage: `该时间段没有 ${asset.name} 的数据`,
              });
            }
          }
        } else {
          // 处理每个趋势期间
          for (const period of trendPeriods) {
            const periodId = `${period.startDate}_${period.endDate}`;

            // 检查是否已经处理过该期间（如TOO_EARLY）
            if (performances.some((p) => p.periodId === periodId)) {
              continue;
            }

            // 考虑lagDays调整趋势期间的起止时间
            const lagDaysMs = (asset.lagDays || 0) * 24 * 60 * 60 * 1000; // 转换为毫秒
            const startDate = new Date(period.startDate).getTime() + lagDaysMs;
            const endDate = new Date(period.endDate).getTime() + lagDaysMs;

            // 过滤出该期间的K线数据
            const periodCandles = allCandles.filter(
              (candle) =>
                candle.timestamp >= startDate && candle.timestamp <= endDate,
            );

            // 记录调整后的实际日期范围（用于调试）
            this.logger.debug(
              `${trendType} 资产 ${asset.name} 趋势期间 ${period.startDate} 至 ${period.endDate} 已调整lagDays(${asset.lagDays})，` +
                `实际查询范围: ${new Date(startDate).toISOString().split("T")[0]} 至 ${new Date(endDate).toISOString().split("T")[0]}`,
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
                statusMessage: ``,
              });
            } else {
              // 该期间没有数据
              performances.push({
                periodId,
                startDate: period.startDate,
                endDate: period.endDate,
                change: 0,
                dataStatus: DataAvailabilityStatus.TOO_EARLY,
                statusMessage: `该时间段没有 ${asset.name} 的数据`,
              });
            }
          }
        }
      } catch (error) {
        // 处理API请求错误
        const errorMessage = error.message || String(error);
        const isRateLimited =
          errorMessage.includes("max sessions") ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("timeout");

        // 处理所有未处理的期间
        for (const period of trendPeriods) {
          const periodId = `${period.startDate}_${period.endDate}`;
          // 检查是否已经处理过该期间
          if (!performances.some((p) => p.periodId === periodId)) {
            performances.push({
              periodId,
              startDate: period.startDate,
              endDate: period.endDate,
              change: 0,
              dataStatus: isRateLimited
                ? DataAvailabilityStatus.RATE_LIMITED
                : DataAvailabilityStatus.REQUEST_FAILED,
              statusMessage: isRateLimited
                ? `请求被限流: ${errorMessage.substring(0, 50)}...`
                : `请求失败: ${errorMessage.substring(0, 50)}...`,
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
        lastUpdated: new Date(),
        trendType,
      };
    } catch (error) {
      this.logger.error(`计算资产 ${asset.name} 的趋势表现失败`, error);
      throw new Error(`计算资产 ${asset.name} 的趋势表现失败`);
    }
  }

  /**
   * 获取所有对比标的
   */
  private async getBenchmarkAssets(): Promise<any[]> {
    try {
      // 获取所有基准资产，包含lagDays属性
      const benchmarks = await this.benchmarkService.getAllBenchmarks();
      this.logger.debug(
        `获取到 ${benchmarks.length} 个对比标的，包含lagDays属性`,
      );
      return benchmarks;
    } catch (error) {
      this.logger.error("获取对比标的数据失败", error);
      throw new Error("获取对比标的数据失败");
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
    interval: string = "1D",
    fromTimestamp: number,
    toTimestamp: number,
  ): Promise<any[]> {
    try {
      // 计算需要获取的天数
      const daysDiff = Math.ceil((toTimestamp - fromTimestamp) / 86400);

      // 一次请求最多获取5000条K线数据
      const maxBatch = 5000;
      let allCandles: any[] = [];

      if (daysDiff <= maxBatch) {
        // 如果天数少于5000天，一次性获取所有数据
        const data = await this.tradingViewService.getKlineData(
          symbol,
          interval,
          daysDiff,
          toTimestamp,
        );

        if (data && data.candles && Array.isArray(data.candles)) {
          allCandles = data.candles;
        }
      } else {
        // 需要分批获取数据
        const batches = Math.ceil(daysDiff / maxBatch);
        this.logger.log(
          `数据范围过大（${daysDiff}天），分${batches}批获取，每批${maxBatch}天`,
        );

        let currentToTimestamp = toTimestamp;

        // 逐批获取数据
        for (let i = 0; i < batches; i++) {
          // 计算当前批次应获取的天数
          const currentBatchDays =
            i === batches - 1
              ? daysDiff - maxBatch * (batches - 1) // 最后一批可能不足maxBatch天
              : maxBatch;

          // 获取当前批次的数据
          const batchData = await this.tradingViewService.getKlineData(
            symbol,
            interval,
            currentBatchDays,
            currentToTimestamp,
          );

          if (batchData && batchData.candles && batchData.candles.length > 0) {
            // 合并K线数据
            allCandles = [...allCandles, ...batchData.candles];

            // 如果获取到的K线数量小于请求的数量，说明没有更多历史数据了
            if (batchData.candles.length < currentBatchDays) {
              this.logger.log(
                `获取到的K线数量(${batchData.candles.length})小于请求的数量(${currentBatchDays})，没有更多历史数据了，停止获取`,
              );
              break;
            }

            // 更新下一批次的结束时间戳
            // 找到当前批次中最早的日期
            const earliestCandleInBatch =
              batchData.candles[batchData.candles.length - 1];
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
            this.logger.warn(`获取第${i + 1}批数据失败，停止获取`);
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
