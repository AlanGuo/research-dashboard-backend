import { Injectable, OnModuleDestroy } from '@nestjs/common';
// 使用 require 导入 JavaScript 模块
const TradingViewLib = require('../lib/tradingview_api/main');
const { TradingView } = TradingViewLib;

@Injectable()
export class TradingViewService implements OnModuleDestroy {
  private client: any;
  private charts: Map<string, any> = new Map();
  
  constructor() {
    this.client = new TradingView.Client();
  }

  /**
   * Get candlestick (K-line) data for a specific symbol
   * @param symbol Symbol to fetch data for (e.g., 'BINANCE:BTCUSDT')
   * @param interval Time interval (e.g., '1D', '4H', '1H', '15', '5')
   * @param limit Number of bars/candles to fetch
   * @returns Candlestick data
   */
  async getKlineData(symbol: string, interval: string, limit: number = 100): Promise<any> {
    try {
      // Format the symbol if needed
      const formattedSymbol = this.formatSymbol(symbol);
      
      // Map the interval to TradingView format
      const tvInterval = this.mapToTVInterval(interval);
      
      // Create a unique chart ID for this request
      const chartId = `${formattedSymbol}_${tvInterval}_${Date.now()}`;
      
      // Create a new chart session
      const chart = new this.client.Session.Chart();
      this.charts.set(chartId, chart);
      
      // Return a promise that resolves when the data is loaded
      return new Promise((resolve, reject) => {
        // Set up error handler
        chart.onError((...err: any[]) => {
          console.error(`Chart error for ${formattedSymbol}:`, ...err);
          reject(new Error(`Failed to fetch data for ${formattedSymbol}: ${err.join(' ')}`))
          this.cleanupChart(chartId);
        });
        
        // Set up symbol loaded handler
        chart.onSymbolLoaded(() => {
          console.log(`Market "${chart.infos.description}" loaded!`);
          
          // Wait for data to be available
          setTimeout(() => {
            try {
              // Get the periods (candles) data
              const periods = chart.periods || [];
              
              // Format the response
              const result = this.transformTVData(periods, formattedSymbol, tvInterval, chart.infos);
              
              // Clean up the chart session
              this.cleanupChart(chartId);
              
              // Resolve with the data
              resolve(result);
            } catch (error) {
              console.error(`Error processing data for ${formattedSymbol}:`, error);
              reject(error);
              this.cleanupChart(chartId);
            }
          }, 2000); // Wait 2 seconds for data to be available
        });
        
        // Set the market and timeframe
        chart.setMarket(formattedSymbol, {
          timeframe: tvInterval,
          range: limit,
          // 调整股息数据：前复权
          adjustment: "dividends"
        });
      });
    } catch (error) {
      console.error(`Error fetching K-line data for ${symbol}:`, error);
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
    
    return mapping[interval] || interval;
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
    
    // If it's a cryptocurrency pair, default to Binance
    if (upperSymbol.includes('USD') || upperSymbol.includes('BTC') || upperSymbol.includes('ETH')) {
      return `BINANCE:${upperSymbol}`;
    }
    
    // // For stocks, default to NASDAQ
    // if (!/[:\\.]/.test(upperSymbol)) {
    //   return `NASDAQ:${upperSymbol}`;
    // }
    
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
    // Sort periods by time (oldest first)
    const sortedPeriods = [...periods].sort((a, b) => a.time - b.time);
    
    // Map periods to candles format
    const candles = sortedPeriods.map(period => ({
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
   * Clean up a chart session
   * @param chartId Chart ID to clean up
   */
  private cleanupChart(chartId: string): void {
    const chart = this.charts.get(chartId);
    if (chart) {
      try {
        chart.delete();
      } catch (error) {
        console.error(`Error deleting chart ${chartId}:`, error);
      }
      this.charts.delete(chartId);
    }
  }

  /**
   * Clean up resources when module is destroyed
   */
  async onModuleDestroy() {
    // Clean up all chart sessions
    for (const [chartId, chart] of this.charts.entries()) {
      try {
        chart.delete();
      } catch (error) {
        console.error(`Error deleting chart ${chartId}:`, error);
      }
    }
    this.charts.clear();
    
    // Close the client connection
    if (this.client) {
      try {
        await this.client.end();
        console.log('TradingView client connection closed');
      } catch (error) {
        console.error('Error closing TradingView client connection:', error);
      }
    }
  }
}
