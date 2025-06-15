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
}
