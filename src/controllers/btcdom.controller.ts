import { Controller, Get, Query } from "@nestjs/common";
import { BtcDomService } from "../services/btcdom.service";

type SortDirection = "ascending" | "descending";

@Controller("v1/btcdom")
export class BtcDomController {
  constructor(private readonly btcDomService: BtcDomService) {}

  /**
   * Get BTC Dominance data
   * @param sortField Optional field to sort by
   * @param direction Sort direction ('ascending' or 'descending')
   * @returns BTC Dominance data
   */
  @Get()
  async getBtcDomData(
    @Query("sortField") sortField?: string,
    @Query("direction") direction: SortDirection = "ascending",
  ) {
    try {
      const data = await this.btcDomService.getBtcDomData(sortField, direction);
      return {
        success: true,
        data,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || "Failed to fetch BTC Dominance data",
      };
    }
  }

  /**
   * Get temperature indicator periods above threshold
   * @param symbol Symbol to fetch data for (default: OTHERS)
   * @param timeframe Timeframe for data (default: 1D)
   * @param startDate Start date in ISO format (default: 2020-01-01T00:00:00.000Z)
   * @param endDate End date in ISO format (default: current date)
   * @param threshold Temperature threshold value (default: 60)
   * @returns Filtered time periods above threshold
   */
  @Get("temperature-periods")
  async getTemperaturePeriods(
    @Query("symbol") symbol?: string,
    @Query("timeframe") timeframe?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("threshold") threshold?: number,
  ) {
    try {
      const data = await this.btcDomService.getTemperaturePeriods(
        symbol,
        timeframe,
        startDate,
        endDate,
        threshold,
      );
      return data;
    } catch (error) {
      return {
        success: false,
        message: error.message || "Failed to fetch temperature periods",
      };
    }
  }
}
