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
    @Query('bars') bars: string = '100'
  ) {
    // Convert bars to number
    const barsCount = parseInt(bars, 10) || 100;
    try {
      // Get K-line data - TradingViewService will format the symbol internally
      const data = await this.tradingViewService.getKlineData(
        symbol,
        interval,
        barsCount
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
}