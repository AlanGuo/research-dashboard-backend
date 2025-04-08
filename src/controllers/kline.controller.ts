import { Controller, Get, Query, Param } from '@nestjs/common';
import { TradingViewService } from '../services/tradingview.service';

@Controller('v1/kline')
export class KlineController {
  constructor(private readonly tradingViewService: TradingViewService) {}

  /**
   * Get K-line data for a specific symbol
   * @param symbol Trading symbol (e.g., 'BINANCE:BTCUSDT')
   * @param interval Time interval (default: '1D')
   * @param bars Number of bars/candles to fetch (default: 100)
   * @returns K-line data
   */
  @Get(':symbol')
  async getKlineData(
    @Param('symbol') symbol: string,
    @Query('interval') interval: string = '1D',
    @Query('bars') bars: string = '100',
    @Query('from') from?: string
  ) {
    try {
      // Get K-line data - TradingViewService will format the symbol internally
      const data = await this.tradingViewService.getKlineData(
        symbol,
        interval,
        parseInt(bars),
        from ? parseInt(from) : undefined
      );
      
      return {
        success: true,
        data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error fetching K-line data for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
  
  /**
   * Get price data for a specific symbol on exact dates
   * @param symbol Trading symbol (e.g., 'BINANCE:BTCUSDT')
   * @param dates Array of dates in ISO format (YYYY-MM-DD)
   * @returns Price data for each requested date
   */
  @Get(':symbol/exact-dates')
  async getExactDatePrices(
    @Param('symbol') symbol: string,
    @Query('dates') dates: string[]
  ) {
    try {
      // console.log(`Received exact-dates request for symbol: ${symbol}, dates:`, dates);
      
      if (!dates || !Array.isArray(dates) || dates.length === 0) {
        return {
          success: false,
          error: 'No dates provided or invalid dates format',
          timestamp: new Date().toISOString(),
        };
      }
      
      // 格式化日期，确保格式一致
      const formattedDates = dates.map(date => {
        // 尝试解析日期
        const parsedDate = new Date(date);
        // 检查是否是有效日期
        if (isNaN(parsedDate.getTime())) {
          console.error(`Invalid date format: ${date}`);
          return null;
        }
        return parsedDate.toISOString().split('T')[0]; // 标准化为 YYYY-MM-DD 格式
      }).filter(date => date !== null);
      
      // 如果所有日期都无效，返回错误
      if (formattedDates.length === 0) {
        return {
          success: false,
          error: 'All provided dates are invalid',
          timestamp: new Date().toISOString(),
        };
      }
      
      // 按时间顺序排序日期
      const sortedDates = [...formattedDates].sort((a, b) => {
        return new Date(a).getTime() - new Date(b).getTime();
      });
      
      // 获取最早日期作为起始点，但要往前推7天以确保能获取到数据
      const latestDate = new Date(sortedDates[sortedDates.length - 1]);
      // 往后推一天
      latestDate.setDate(latestDate.getDate() + 1);
      const fromTimestamp = Math.floor(latestDate.getTime() / 1000);
      
      // 计算需要获取的天数（从最早到最晚日期 + 缓冲）
      const earliestDate = new Date(sortedDates[0]);
      const daysDiff = Math.ceil((latestDate.getTime() - earliestDate.getTime()) / (1000 * 60 * 60 * 24));

      // 一次性获取整个日期范围的数据
      const data = await this.tradingViewService.getKlineData(
        symbol,
        '1D',  // 始终使用日线数据
        daysDiff,  // 添加额外缓冲以确保获取所有需要的日期
        fromTimestamp
      );
      
      // 从获取的数据中提取仅请求的日期
      const dateMap = new Map();
      if (data && data.candles && data.candles.length > 0) {
        data.candles.forEach(candle => {
          const dateKey = new Date(candle.datetime).toISOString().split('T')[0];
          dateMap.set(dateKey, candle.close);
        });
      } else {
        console.log(`No candles data received from TradingView`);
      }
      
      // 创建包含请求的确切日期的结果数组
      const result = formattedDates.map(date => {
        const price = dateMap.get(date);
        return {
          date: date,
          price: price !== undefined ? price : null
        };
      });
      
      return {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Error fetching exact date prices for ${symbol}:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}