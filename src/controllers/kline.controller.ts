import { Controller, Get, Query, Param } from '@nestjs/common';
import { TradingViewService } from '../services/tradingview.service';
import { console } from 'inspector';

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
      
      // 获取最晚日期作为起始点
      const latestDate = new Date(sortedDates[sortedDates.length - 1]);
      // 往后推一天
      latestDate.setDate(latestDate.getDate() + 1);
      const fromTimestamp = Math.floor(latestDate.getTime() / 1000);
      
      // 计算需要获取的天数（从最早到最晚日期 + 缓冲）
      const earliestDate = new Date(sortedDates[0]);
      const daysDiff = Math.ceil((latestDate.getTime() - earliestDate.getTime()) / (1000 * 60 * 60 * 24));

      // 一次性获取整个日期范围的数据
      // daysDiff 最大为 maxBatch 天, 如果超过 maxBatch 天，则分批获取
      const maxBatch = 1000;
      let data: any = null;
      
      if (daysDiff > maxBatch) {
        // 分批获取数据
        const batches = Math.ceil(daysDiff / maxBatch);
        console.log(`Data range too large (${daysDiff} days), fetching in ${batches} batches of ${maxBatch} days each`);
        
        let allCandles = [];
        let currentFromTimestamp = fromTimestamp;
        
        // 逐批获取数据
        for (let i = 0; i < batches; i++) {
          // 计算当前批次应获取的天数
          const currentBatchDays = (i === batches - 1) 
            ? (daysDiff - (maxBatch * (batches - 1))) // 最后一批可能不足 maxBatch 天
            : maxBatch;
          
          // 获取当前批次的数据
          const batchData = await this.tradingViewService.getKlineData(
            symbol,
            '1D',  // 始终使用日线数据
            currentBatchDays,
            currentFromTimestamp
          );
          
          if (batchData && batchData.candles && batchData.candles.length > 0) {
            allCandles = [...allCandles, ...batchData.candles];
            
            // 更新下一批次的起始时间戳
            // 找到当前批次中最早的日期
            const earliestCandleInBatch = batchData.candles[batchData.candles.length - 1];
            if (earliestCandleInBatch && earliestCandleInBatch.datetime) {
              const earliestDate = new Date(earliestCandleInBatch.datetime);
              // 往前推一天作为下一批次的结束时间
              earliestDate.setDate(earliestDate.getDate() - 1);
              currentFromTimestamp = Math.floor(earliestDate.getTime() / 1000);
            }
          } else {
            console.log(`No data received for batch ${i+1}`);
            break; // 如果某一批次没有数据，则停止获取
          }
        }
        
        data = {
          candles: allCandles
        };
      } else {
        // 一次性获取所有数据
        data = await this.tradingViewService.getKlineData(
          symbol,
          '1D',  // 始终使用日线数据
          daysDiff,  // 添加额外缓冲以确保获取所有需要的日期
          fromTimestamp
        );
      }
      // 从获取的数据中提取仅请求的日期
      if (data && data.candles && data.candles.length > 0) {
        // 创建包含请求的确切日期的结果数组
        const candles = data.candles;
        const result = formattedDates.map(date => {
          const candle = candles.find(c => c.datetime.split('T')[0] === date);
          // 如果没有则循环向前推，直到找到价格
          if (candle === undefined) {
            for (let i = 1; i <= 30; i++) {
              const prevDate = new Date(date);
              prevDate.setDate(prevDate.getDate() - i);
              const prevCandle = candles.find(c => c.datetime.split('T')[0] === prevDate.toISOString().split('T')[0]);
              if (prevCandle !== undefined) {
                return {
                  date: date,
                  price: prevCandle.close
                };
              }
            }
          }
          return {
            date: date,
            price: candle !== undefined ? candle.close : null
          };
        });
        return {
          success: true,
          data: result,
          timestamp: new Date().toISOString(),
        };
      } else {
        console.log(`No candles data received from TradingView`);
        return {
          success: false,
          error: 'No candles data received from TradingView',
          timestamp: new Date().toISOString(),
        };
      }
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