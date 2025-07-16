import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
// 使用路径映射导入 JavaScript 模块
import { Client, getIndicator } from "@alandlguo/tradingview-api";

@Injectable()
export class TradingViewService implements OnModuleDestroy {
  private readonly logger = new Logger(TradingViewService.name);
  private client: any;
  // 扩展charts的存储结构，添加创建时间和请求信息
  private charts: Map<
    string,
    {
      chart: any;
      createdAt: number;
      symbol: string;
      interval: string;
      timeoutRef?: NodeJS.Timeout;
    }
  > = new Map();
  private requestCounter = 0;
  private timeoutCounter = 0; // 超时请求计数器
  private readonly RESET_THRESHOLD = 1000; // 处理1000个请求后重置客户端
  private readonly TIMEOUT_RESET_THRESHOLD = 5; // 5次超时请求后重置客户端
  private readonly CHART_TIMEOUT_MS = 15000; // 15秒超时
  private readonly STALE_CHART_THRESHOLD_MS = 30000; // 30秒视为过期chart

  constructor() {
    this.initClient();
    // 定期清理过期的chart
    setInterval(() => this.cleanupStaleCharts(), 60000); // 每分钟清理一次
  }

  private initClient(): void {
    try {
      this.client = new Client();
      this.logger.log("TradingView client initialized");
    } catch (error) {
      this.logger.error(
        `Failed to initialize TradingView client: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * 清理过期的chart对象
   * 定期调用此方法可以防止资源泄漏
   */
  private cleanupStaleCharts(): void {
    const now = new Date().getTime();
    let cleanedCount = 0;
    let totalCount = 0;

    for (const [chartId, chartData] of this.charts.entries()) {
      totalCount++;
      if (now - chartData.createdAt > this.STALE_CHART_THRESHOLD_MS) {
        this.logger.debug(
          `Cleaning up stale chart: ${chartId} (${chartData.symbol}, ${chartData.interval})`,
        );
        this.cleanupChart(chartId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0 || totalCount > 10) {
      this.logger.log(
        `Stale charts cleanup: removed ${cleanedCount}/${totalCount} charts`,
      );
    }
  }

  /**
   * 检查客户端健康状态
   * @returns 客户端是否健康
   */
  private async checkClientHealth(): Promise<boolean> {
    try {
      this.logger.debug("Performing client health check...");
      // 执行一个简单的查询测试客户端是否正常
      const testChart = new this.client.Session.Chart();
      const testPromise = new Promise<boolean>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Health check timeout"));
        }, 5000);

        testChart.onUpdate(() => {
          clearTimeout(timeoutId);
          resolve(true);
        });

        testChart.onError(() => {
          clearTimeout(timeoutId);
          reject(new Error("Health check failed"));
        });

        // 设置一个简单的市场查询
        testChart.setMarket("BINANCE:BTCUSDT", { timeframe: "D", range: 1 });
      });

      const result = await testPromise;
      try {
        testChart.delete();
      } catch (error) {
        this.logger.warn(`Error deleting test chart: ${error.message}`);
      }
      this.logger.debug("Client health check passed");
      return result;
    } catch (error) {
      this.logger.error(
        `Client health check failed: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * 重置TradingView客户端
   */
  private async resetClient(): Promise<void> {
    this.logger.warn("Resetting TradingView client...");

    // 先清理所有charts
    const chartIds = Array.from(this.charts.keys());
    for (const chartId of chartIds) {
      this.cleanupChart(chartId);
    }

    // 关闭旧客户端
    if (this.client) {
      try {
        await this.client.end();
        this.logger.log("Old TradingView client closed successfully");
      } catch (error) {
        this.logger.error(
          `Error closing TradingView client: ${error.message}`,
          error.stack,
        );
      }
    }

    // 创建新客户端
    this.initClient();
    this.requestCounter = 0;
    this.timeoutCounter = 0; // 重置超时计数器
    this.logger.log("TradingView client reset completed");
  }

  /**
   * Get candlestick (K-line) data for a specific symbol
   * @param symbol Symbol to fetch data for (e.g., 'BINANCE:BTCUSDT')
   * @param interval Time interval (e.g., '1D', '4H', '1H', '15', '5')
   * @param limit Number of bars/candles to fetch
   * @param from Timestamp to start fetching from (optional), 7 days ago: (Date.now() / 1000) - 86400 * 7
   * @returns Candlestick data
   */
  async getKlineData(
    symbol: string,
    interval: string,
    limit: number = 100,
    from?: number,
  ): Promise<any> {
    this.requestCounter++;
    const requestId = `REQ_${this.requestCounter}_${Date.now()}`;
    this.logger.log(
      `[${requestId}] Kline request: ${symbol}, ${interval}, limit=${limit}`,
    );

    // 检查是否需要重置客户端
    if (this.requestCounter >= this.RESET_THRESHOLD) {
      this.logger.warn(
        `Request threshold reached (${this.requestCounter}), resetting client...`,
      );
      await this.resetClient();
    }

    // 检查超时请求数量是否超过阈值
    if (this.timeoutCounter >= this.TIMEOUT_RESET_THRESHOLD) {
      this.logger.warn(
        `Timeout threshold reached (${this.timeoutCounter}), resetting client...`,
      );
      await this.resetClient();
    }

    // 如果请求计数是100的倍数，检查客户端健康状态
    if (this.requestCounter % 100 === 0) {
      const isHealthy = await this.checkClientHealth();
      if (!isHealthy) {
        this.logger.warn("Client health check failed, resetting client...");
        await this.resetClient();
      }
    }

    try {
      // Format the symbol if needed
      const formattedSymbol = this.formatSymbol(symbol);

      // Map the interval to TradingView format
      const tvInterval = this.mapToTVInterval(interval);

      // Create a unique chart ID for this request with a random suffix
      const chartId = `${formattedSymbol}_${tvInterval}_${Math.random().toString(36).slice(2)}`;
      this.logger.debug(`[${requestId}] Created chart ID: ${chartId}`);

      if (this.charts.has(chartId)) {
        this.logger.warn(
          `[${requestId}] Chart ID collision detected, cleaning up existing chart`,
        );
        this.cleanupChart(chartId);
      }

      const chart = new this.client.Session.Chart();
      const startTime = new Date().getTime();

      // 存储chart信息，包括创建时间和请求信息
      this.charts.set(chartId, {
        chart,
        createdAt: startTime,
        symbol: formattedSymbol,
        interval: tvInterval,
      });

      this.logger.debug(
        `[${requestId}] Chart created, active charts: ${this.charts.size}`,
      );

      // 使用Promise.race实现更可靠的超时处理
      const dataPromise = new Promise((resolve, reject) => {
        // 设置错误处理
        chart.onError((...err: any[]) => {
          this.logger.error(
            `[${requestId}] Chart error for ${formattedSymbol}: ${err.join(" ")}`,
          );
          this.cleanupChart(chartId);
          reject(
            new Error(
              `Failed to fetch data for ${formattedSymbol}: ${err.join(" ")}`,
            ),
          );
        });

        // 设置数据更新处理
        chart.onUpdate(() => {
          try {
            // 获取K线数据
            const periods = chart.periods || [];
            this.logger.debug(
              `[${requestId}] Received ${periods.length} periods for ${formattedSymbol}`,
            );

            // 格式化响应数据
            const result = this.transformTVData(
              periods,
              formattedSymbol,
              tvInterval,
              chart.infos,
            );

            // 计算请求耗时
            const endTime = new Date().getTime();
            const duration = endTime - startTime;
            this.logger.log(
              `[${requestId}] Request completed in ${duration}ms, received ${periods.length} candles`,
            );

            // 清理资源并返回结果
            this.cleanupChart(chartId);
            resolve(result);
          } catch (error) {
            this.logger.error(
              `[${requestId}] Error processing data: ${error.message}`,
              error.stack,
            );
            this.cleanupChart(chartId);
            reject(error);
          }
        });

        // 设置市场和时间范围
        const marketOptions: any = {
          timeframe: tvInterval,
          range: limit,
          // 调整股息数据：前复权
          adjustment: "dividends",
        };

        // 正确使用from参数
        if (from) {
          marketOptions.to = from;
          this.logger.debug(
            `[${requestId}] Using custom 'from' timestamp: ${from}`,
          );
        }

        this.logger.debug(
          `[${requestId}] Setting market for ${formattedSymbol}`,
        );
        chart.setMarket(formattedSymbol, marketOptions);
      });

      // 超时处理Promise
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          this.logger.error(
            `[${requestId}] Request timed out after ${this.CHART_TIMEOUT_MS}ms`,
          );
          // 增加超时计数器
          this.timeoutCounter++;
          this.logger.warn(
            `Timeout counter increased to ${this.timeoutCounter}`,
          );

          this.cleanupChart(chartId);
          reject(
            new Error(
              `Request for ${formattedSymbol} timed out after ${this.CHART_TIMEOUT_MS}ms`,
            ),
          );
        }, this.CHART_TIMEOUT_MS);

        // 保存timeout引用以便在成功时清除
        const chartData = this.charts.get(chartId);
        if (chartData) {
          chartData.timeoutRef = timeoutId;
        }
      });

      // 使用Promise.race竞争数据获取和超时
      return await Promise.race([dataPromise, timeoutPromise]);
    } catch (error) {
      this.logger.error(
        `[${requestId}] Error fetching K-line data for ${symbol}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get temperature indicator data for a specific symbol
   * @param symbolId Symbol ID to fetch indicator for (e.g., 'BINANCE:BTCUSDT')
   * @param timeframe Time interval (e.g., 'D', '240', '60')
   * @param session Session token for TradingView API
   * @param signature Signature for TradingView API
   * @param indicatorName Temperature indicator name from config
   * @returns Temperature indicator data
   */
  async getTemperatureIndicator(
    symbolId: string,
    timeframe: string,
    session: string,
    signature: string,
    indicatorName: string,
    startDate?: string,
    endDate?: string,
  ): Promise<any> {
    this.requestCounter++;
    const requestId = `TEMP_${this.requestCounter}_${Date.now()}`;
    this.logger.log(
      `[${requestId}] Temperature indicator request: ${symbolId}, ${timeframe}, dates: ${startDate || "N/A"} to ${endDate || "N/A"}`,
    );

    // 检查是否需要重置客户端
    if (this.requestCounter >= this.RESET_THRESHOLD) {
      this.logger.warn(
        `Request threshold reached (${this.requestCounter}), resetting client...`,
      );
      await this.resetClient();
    }

    // 检查超时请求数量是否超过阈值
    if (this.timeoutCounter >= this.TIMEOUT_RESET_THRESHOLD) {
      this.logger.warn(
        `Timeout threshold reached (${this.timeoutCounter}), resetting client...`,
      );
      await this.resetClient();
    }

    try {
      const formattedSymbol = this.formatSymbol(symbolId);
      const tvInterval = this.mapToTVInterval(timeframe);

      this.logger.debug(
        `[${requestId}] Symbol formatting: ${symbolId} -> ${formattedSymbol}`,
      );
      this.logger.debug(
        `[${requestId}] Timeframe mapping: ${timeframe} -> ${tvInterval}`,
      );

      // Create a unique chart ID for this request
      const chartId = `temp_${formattedSymbol}_${tvInterval}_${Math.random().toString(36).slice(2)}`;
      this.logger.debug(`[${requestId}] Created chart ID: ${chartId}`);

      if (this.charts.has(chartId)) {
        this.logger.warn(
          `[${requestId}] Chart ID collision detected, cleaning up existing chart`,
        );
        this.cleanupChart(chartId);
      }

      // Create a new client with custom session and signature
      const customClient = new Client({
        token: session,
        signature
      });

      const chart = new customClient.Session.Chart();
      const startTime = new Date().getTime();

      // 存储chart信息
      this.charts.set(chartId, {
        chart,
        createdAt: startTime,
        symbol: formattedSymbol,
        interval: tvInterval,
      });

      this.logger.debug(
        `[${requestId}] Chart created, active charts: ${this.charts.size}`,
      );

      // 使用Promise.race实现可靠的超时处理
      const indicatorPromise = new Promise(async (resolve, reject) => {
        try {
          // 设置错误处理
          chart.onError((...err: any[]) => {
            this.logger.error(
              `[${requestId}] Chart error for ${formattedSymbol}: ${err.join(" ")}`,
            );
            // 使用统一的资源清理方法
            this.cleanupTemperatureResources(customClient, chartId, requestId);
            reject(
              new Error(
                `Failed to fetch temperature indicator for ${formattedSymbol}: ${err.join(" ")}`,
              ),
            );
          });

          // 计算时间范围参数
          const marketOptions: any = {
            timeframe: tvInterval,
            adjustment: "dividends",
          };

          if (endDate) {
            // 将结束日期转换为Unix时间戳（秒）
            const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);
            marketOptions.to = endTimestamp;

            if (startDate) {
              // 计算开始和结束日期之间的天数差异
              const startTimestamp = Math.floor(
                new Date(startDate).getTime() / 1000,
              );
              const daysDiff = Math.ceil(
                (endTimestamp - startTimestamp) / (24 * 60 * 60),
              );

              // 根据时间框架调整range值
              let periodsNeeded = daysDiff;
              if (tvInterval === "1D") {
                periodsNeeded = daysDiff;
              } else if (tvInterval === "1W") {
                periodsNeeded = Math.ceil(daysDiff / 7);
              } else if (tvInterval === "1M") {
                periodsNeeded = Math.ceil(daysDiff / 30);
              }

              // 设置为正数表示获取to时间点之前的数据
              marketOptions.range = Math.max(periodsNeeded, 100); // 至少获取100个周期
            } else {
              // 如果只有结束日期，获取足够的历史数据
              marketOptions.range = 1000; // 获取1000个周期的历史数据
            }
          } else {
            // 如果没有指定日期范围，使用默认值获取更多历史数据
            marketOptions.range = 1000; // 获取1000个周期而不是仅仅2个
          }

          this.logger.debug(
            `[${requestId}] Setting market with options: ${JSON.stringify(marketOptions)}`,
          );

          // 设置市场
          chart.setMarket(formattedSymbol, marketOptions);

          this.logger.debug(
            `[${requestId}] Market set successfully for symbol: ${formattedSymbol}`,
          );

          this.logger.debug(
            `[${requestId}] Loading temperature indicator: ${indicatorName}`,
          );

          // 获取指标
          this.logger.debug(
            `[${requestId}] Fetching indicator with name: ${indicatorName}`,
          );

          const tempIndicator = await getIndicator(
            indicatorName,
            "last",
            session,
            signature,
          );

          if (!tempIndicator) {
            this.logger.error(
              `[${requestId}] Temperature indicator ${indicatorName} not found or failed to load`,
            );
            // 使用统一的资源清理方法
            this.cleanupTemperatureResources(customClient, chartId, requestId);
            reject(
              new Error(`Temperature indicator ${indicatorName} not found`),
            );
            return;
          }

          this.logger.debug(
            `[${requestId}] Indicator loaded successfully: ${tempIndicator.description || "No description"}`,
          );

          const liveIndicator = new chart.Study(tempIndicator);

          liveIndicator.onReady(() => {
            this.logger.debug(
              `[${requestId}] Temperature indicator ${indicatorName} loaded`,
            );
          });

          liveIndicator.onUpdate(() => {
            try {
              const periods = liveIndicator.periods || [];
              this.logger.debug(
                `[${requestId}] Received ${periods.length} indicator periods for ${formattedSymbol}`,
              );

              if (periods.length > 0) {
                this.logger.debug(
                  `[${requestId}] Sample period data: ${JSON.stringify(periods.slice(0, 3))}`,
                );
              } else {
                this.logger.warn(
                  `[${requestId}] No periods received - possible issues: invalid symbol, no data for timeframe, or indicator not working`,
                );
              }

              // 计算请求耗时
              const endTime = new Date().getTime();
              const duration = endTime - startTime;
              this.logger.log(
                `[${requestId}] Temperature indicator request completed in ${duration}ms`,
              );

              // 使用统一的资源清理方法
              this.cleanupTemperatureResources(
                customClient,
                chartId,
                requestId,
              );

              resolve({
                symbol: formattedSymbol,
                timeframe: tvInterval,
                indicator: indicatorName,
                periods,
                count: periods.length,
                lastUpdated: new Date().toISOString(),
              });
            } catch (error) {
              this.logger.error(
                `[${requestId}] Error processing indicator data: ${error.message}`,
                error.stack,
              );
              // 使用统一的资源清理方法
              this.cleanupTemperatureResources(
                customClient,
                chartId,
                requestId,
              );
              reject(error);
            }
          });
        } catch (error) {
          this.logger.error(
            `[${requestId}] Error setting up indicator: ${error.message}`,
            error.stack,
          );
          // 使用统一的资源清理方法
          this.cleanupTemperatureResources(customClient, chartId, requestId);
          reject(error);
        }
      });

      // 超时处理Promise
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          this.logger.error(
            `[${requestId}] Temperature indicator request timed out after ${this.CHART_TIMEOUT_MS}ms`,
          );
          this.timeoutCounter++;
          this.logger.warn(
            `Timeout counter increased to ${this.timeoutCounter}`,
          );

          // 使用统一的资源清理方法
          this.cleanupTemperatureResources(customClient, chartId, requestId);
          reject(
            new Error(
              `Temperature indicator request for ${formattedSymbol} timed out after ${this.CHART_TIMEOUT_MS}ms`,
            ),
          );
        }, this.CHART_TIMEOUT_MS);

        // 保存timeout引用
        const chartData = this.charts.get(chartId);
        if (chartData) {
          chartData.timeoutRef = timeoutId;
        }
      });

      // 使用Promise.race竞争数据获取和超时
      return await Promise.race([indicatorPromise, timeoutPromise]);
    } catch (error) {
      this.logger.error(
        `[${requestId}] Error fetching temperature indicator for ${symbolId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Map common interval strings to TradingView format
   * @param interval Interval string (e.g., '1d', '8h', '4h', '1h', '15m', '5m')
   * @returns TradingView interval format
   */
  private mapToTVInterval(interval: string): string {
    const mapping: { [key: string]: string } = {
      "1m": "1",
      "5m": "5",
      "15m": "15",
      "30m": "30",
      "1h": "60",
      "1H": "60",
      "2h": "120",
      "4h": "240",
      "4H": "240",
      "8h": "480",
      "8H": "480",
      "1d": "D",
      "1D": "D",
      "1w": "W",
      "1W": "W",
      "1M": "M",
    };

    const result = mapping[interval] || interval;
    return result;
  }

  /**
   * Format a symbol to ensure it's compatible with TradingView
   * @param symbol Symbol string (e.g., 'BTCUSDT' or 'BINANCE:BTCUSDT')
   * @returns Formatted symbol string
   */
  private formatSymbol(symbol: string): string {
    // Convert to uppercase for case-insensitive comparison
    const upperSymbol = symbol.toUpperCase();

    // If the symbol already contains a colon, use it as is
    if (upperSymbol.includes(":")) {
      return upperSymbol;
    }

    // Return as is if it has other formatting
    return upperSymbol;
  }

  /**
   * Transform TradingView data into a standardized format
   * @param periods TradingView periods data
   * @param symbol The trading symbol
   * @param interval The time interval
   * @param marketInfo Market information
   * @returns Transformed data
   */
  private transformTVData(
    periods: any[],
    symbol: string,
    interval: string,
    marketInfo: any,
  ) {
    // Map periods to candles format
    const candles = periods.map((period) => ({
      timestamp: period.time * 1000, // Convert to milliseconds
      datetime: new Date(period.time * 1000).toISOString(),
      open: period.open,
      high: period.max, // TradingView uses 'max' instead of 'high'
      low: period.min, // TradingView uses 'min' instead of 'low'
      close: period.close,
      volume: period.volume,
    }));

    // Create response object
    return {
      symbol,
      interval,
      count: candles.length,
      candles,
      marketInfo: {
        description: marketInfo?.description || symbol,
        exchange: marketInfo?.exchange || "",
        currency: marketInfo?.currency_code || "",
        type: marketInfo?.type || "",
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 清理温度指标请求的资源（包括自定义客户端和图表）
   * @param customClient 自定义客户端
   * @param chartId 图表ID
   * @param requestId 请求ID
   */
  private cleanupTemperatureResources(
    customClient: any,
    chartId: string,
    requestId: string,
  ): void {
    // 异步清理资源，不阻塞当前流程
    (async () => {
      try {
        // 先关闭自定义客户端
        await customClient.end();
        this.logger.debug(`[${requestId}] Custom client closed successfully`);
      } catch (error) {
        this.logger.error(
          `[${requestId}] Error closing custom client: ${error.message}`,
        );
      } finally {
        // 无论客户端是否成功关闭，都要清理图表资源
        this.cleanupChart(chartId);
      }
    })();
  }

  /**
   * 清理单个chart会话
   * @param chartId 要清理的chart ID
   */
  private cleanupChart(chartId: string): void {
    const chartData = this.charts.get(chartId);
    if (chartData) {
      try {
        // 清除超时定时器
        if (chartData.timeoutRef) {
          clearTimeout(chartData.timeoutRef);
        }

        // 移除所有事件监听器
        if (chartData.chart) {
          try {
            chartData.chart.onUpdate(null);
            chartData.chart.onError(null);
            chartData.chart.delete();
          } catch (innerError) {
            this.logger.error(
              `Error cleaning up chart events for ${chartId}: ${innerError.message}`,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `Error deleting chart ${chartId}: ${error.message}`,
          error.stack,
        );
      } finally {
        // 无论如何都要从Map中删除
        this.charts.delete(chartId);
        this.logger.debug(
          `Chart ${chartId} removed, remaining charts: ${this.charts.size}`,
        );
      }
    }
  }

  /**
   * Clean up resources when module is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log(
      "TradingViewService is being destroyed, cleaning up resources...",
    );

    // Clean up all chart sessions
    const chartIds = Array.from(this.charts.keys());
    this.logger.log(`Cleaning up ${chartIds.length} active charts`);

    for (const chartId of chartIds) {
      try {
        this.cleanupChart(chartId);
      } catch (error) {
        this.logger.error(
          `Error cleaning up chart ${chartId}: ${error.message}`,
        );
      }
    }
    this.charts.clear();

    // Close the client connection
    if (this.client) {
      try {
        await this.client.end();
        this.logger.log("TradingView client connection closed successfully");
      } catch (error) {
        this.logger.error(
          `Error closing TradingView client connection: ${error.message}`,
          error.stack,
        );
      }
    }

    this.logger.log("TradingViewService cleanup completed");
  }
}
