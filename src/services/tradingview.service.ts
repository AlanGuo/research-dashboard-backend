import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
// 使用 require 导入 JavaScript 模块
const TradingViewLib = require('../lib/tradingview_api/main');
const { TradingView } = TradingViewLib;

@Injectable()
export class TradingViewService implements OnModuleDestroy {
  private readonly logger = new Logger(TradingViewService.name);
  private client: any;
  // 扩展charts的存储结构，添加创建时间和请求信息
  private charts: Map<string, { 
    chart: any, 
    createdAt: number, 
    symbol: string, 
    interval: string,
    timeoutRef?: NodeJS.Timeout
  }> = new Map();
  private requestCounter = 0;
  private readonly RESET_THRESHOLD = 1000; // 处理1000个请求后重置客户端
  private readonly CHART_TIMEOUT_MS = 15000; // 15秒超时
  private readonly STALE_CHART_THRESHOLD_MS = 30000; // 30秒视为过期chart
  
  constructor() {
    this.initClient();
    // 定期清理过期的chart
    setInterval(() => this.cleanupStaleCharts(), 60000); // 每分钟清理一次
  }
  
  private initClient(): void {
    try {
      this.client = new TradingView.Client();
      this.logger.log('TradingView client initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize TradingView client: ${error.message}`, error.stack);
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
        this.logger.debug(`Cleaning up stale chart: ${chartId} (${chartData.symbol}, ${chartData.interval})`);
        this.cleanupChart(chartId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0 || totalCount > 10) {
      this.logger.log(`Stale charts cleanup: removed ${cleanedCount}/${totalCount} charts`);
    }
  }
  
  /**
   * 检查客户端健康状态
   * @returns 客户端是否健康
   */
  private async checkClientHealth(): Promise<boolean> {
    try {
      this.logger.debug('Performing client health check...');
      // 执行一个简单的查询测试客户端是否正常
      const testChart = new this.client.Session.Chart();
      const testPromise = new Promise<boolean>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Health check timeout'));
        }, 5000);
        
        testChart.onUpdate(() => {
          clearTimeout(timeoutId);
          resolve(true);
        });
        
        testChart.onError(() => {
          clearTimeout(timeoutId);
          reject(new Error('Health check failed'));
        });
        
        // 设置一个简单的市场查询
        testChart.setMarket('BINANCE:BTCUSDT', {timeframe: 'D', range: 1});
      });
      
      const result = await testPromise;
      try {
        testChart.delete();
      } catch (error) {
        this.logger.warn(`Error deleting test chart: ${error.message}`);
      }
      this.logger.debug('Client health check passed');
      return result;
    } catch (error) {
      this.logger.error(`Client health check failed: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * 重置TradingView客户端
   */
  private async resetClient(): Promise<void> {
    this.logger.warn('Resetting TradingView client...');
    
    // 先清理所有charts
    const chartIds = Array.from(this.charts.keys());
    for (const chartId of chartIds) {
      this.cleanupChart(chartId);
    }
    
    // 关闭旧客户端
    if (this.client) {
      try {
        await this.client.end();
        this.logger.log('Old TradingView client closed successfully');
      } catch (error) {
        this.logger.error(`Error closing TradingView client: ${error.message}`, error.stack);
      }
    }
    
    // 创建新客户端
    this.initClient();
    this.requestCounter = 0;
    this.logger.log('TradingView client reset completed');
  }

  /**
   * Get candlestick (K-line) data for a specific symbol
   * @param symbol Symbol to fetch data for (e.g., 'BINANCE:BTCUSDT')
   * @param interval Time interval (e.g., '1D', '4H', '1H', '15', '5')
   * @param limit Number of bars/candles to fetch
   * @param from Timestamp to start fetching from (optional), 7 days ago: (Date.now() / 1000) - 86400 * 7
   * @returns Candlestick data
   */
  async getKlineData(symbol: string, interval: string, limit: number = 100, from?: number): Promise<any> {
    this.requestCounter++;
    const requestId = `REQ_${this.requestCounter}_${Date.now()}`;
    this.logger.log(`[${requestId}] Kline request: ${symbol}, ${interval}, limit=${limit}`);
    
    // 检查是否需要重置客户端
    if (this.requestCounter >= this.RESET_THRESHOLD) {
      this.logger.warn(`Request threshold reached (${this.requestCounter}), resetting client...`);
      await this.resetClient();
    }
    
    // 如果请求计数是100的倍数，检查客户端健康状态
    if (this.requestCounter % 100 === 0) {
      const isHealthy = await this.checkClientHealth();
      if (!isHealthy) {
        this.logger.warn('Client health check failed, resetting client...');
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
        this.logger.warn(`[${requestId}] Chart ID collision detected, cleaning up existing chart`);
        this.cleanupChart(chartId);
      }
      
      const chart = new this.client.Session.Chart();
      const startTime = new Date().getTime();
      
      // 存储chart信息，包括创建时间和请求信息
      this.charts.set(chartId, {
        chart,
        createdAt: startTime,
        symbol: formattedSymbol,
        interval: tvInterval
      });
      
      this.logger.debug(`[${requestId}] Chart created, active charts: ${this.charts.size}`);
      
      // 使用Promise.race实现更可靠的超时处理
      const dataPromise = new Promise((resolve, reject) => {
        // 设置错误处理
        chart.onError((...err: any[]) => {
          this.logger.error(`[${requestId}] Chart error for ${formattedSymbol}: ${err.join(' ')}`);
          this.cleanupChart(chartId);
          reject(new Error(`Failed to fetch data for ${formattedSymbol}: ${err.join(' ')}`));
        });
        
        // 设置数据更新处理
        chart.onUpdate(() => {
          try {
            // 获取K线数据
            const periods = chart.periods || [];
            this.logger.debug(`[${requestId}] Received ${periods.length} periods for ${formattedSymbol}`);
            
            // 格式化响应数据
            const result = this.transformTVData(periods, formattedSymbol, tvInterval, chart.infos);
            
            // 计算请求耗时
            const endTime = new Date().getTime();
            const duration = endTime - startTime;
            this.logger.log(`[${requestId}] Request completed in ${duration}ms, received ${periods.length} candles`);
            
            // 清理资源并返回结果
            this.cleanupChart(chartId);
            resolve(result);
          } catch (error) {
            this.logger.error(`[${requestId}] Error processing data: ${error.message}`, error.stack);
            this.cleanupChart(chartId);
            reject(error);
          }
        });
        
        // 设置市场和时间范围
        const marketOptions: any = {
          timeframe: tvInterval,
          range: limit,
          // 调整股息数据：前复权
          adjustment: "dividends"
        };
        
        // 正确使用from参数
        if (from) {
          marketOptions.to = from;
          this.logger.debug(`[${requestId}] Using custom 'from' timestamp: ${from}`);
        }
        
        this.logger.debug(`[${requestId}] Setting market for ${formattedSymbol}`);
        chart.setMarket(formattedSymbol, marketOptions);
      });
      
      // 超时处理Promise
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          this.logger.error(`[${requestId}] Request timed out after ${this.CHART_TIMEOUT_MS}ms`);
          this.cleanupChart(chartId);
          reject(new Error(`Request for ${formattedSymbol} timed out after ${this.CHART_TIMEOUT_MS}ms`));
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
      this.logger.error(`[${requestId}] Error fetching K-line data for ${symbol}: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  /**
   * Map common interval strings to TradingView format
   * @param interval Interval string (e.g., '1d', '4h', '1h', '15m', '5m')
   * @returns TradingView interval format
   */
  private mapToTVInterval(interval: string): string {
    const mapping: { [key: string]: string } = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '1H': '60',
      '2h': '120',
      '4h': '240',
      '4H': '240',
      '1d': 'D',
      '1D': 'D',
      '1w': 'W',
      '1W': 'W',
      '1M': 'M'
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
    if (upperSymbol.includes(':')) {
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
  private transformTVData(periods: any[], symbol: string, interval: string, marketInfo: any) {
    // Map periods to candles format
    const candles = periods.map(period => ({
      timestamp: period.time * 1000, // Convert to milliseconds
      datetime: new Date(period.time * 1000).toISOString(),
      open: period.open,
      high: period.max,  // TradingView uses 'max' instead of 'high'
      low: period.min,   // TradingView uses 'min' instead of 'low'
      close: period.close,
      volume: period.volume
    }));

    // Create response object
    return {
      symbol,
      interval,
      count: candles.length,
      candles,
      marketInfo: {
        description: marketInfo?.description || symbol,
        exchange: marketInfo?.exchange || '',
        currency: marketInfo?.currency_code || '',
        type: marketInfo?.type || ''
      },
      lastUpdated: new Date().toISOString()
    };
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
            this.logger.error(`Error cleaning up chart events for ${chartId}: ${innerError.message}`);
          }
        }
      } catch (error) {
        this.logger.error(`Error deleting chart ${chartId}: ${error.message}`, error.stack);
      } finally {
        // 无论如何都要从Map中删除
        this.charts.delete(chartId);
        this.logger.debug(`Chart ${chartId} removed, remaining charts: ${this.charts.size}`);
      }
    }
  }

  /**
   * Clean up resources when module is destroyed
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('TradingViewService is being destroyed, cleaning up resources...');
    
    // Clean up all chart sessions
    const chartIds = Array.from(this.charts.keys());
    this.logger.log(`Cleaning up ${chartIds.length} active charts`);
    
    for (const chartId of chartIds) {
      try {
        this.cleanupChart(chartId);
      } catch (error) {
        this.logger.error(`Error cleaning up chart ${chartId}: ${error.message}`);
      }
    }
    this.charts.clear();
    
    // Close the client connection
    if (this.client) {
      try {
        await this.client.end();
        this.logger.log('TradingView client connection closed successfully');
      } catch (error) {
        this.logger.error(`Error closing TradingView client connection: ${error.message}`, error.stack);
      }
    }
    
    this.logger.log('TradingViewService cleanup completed');
  }
}
