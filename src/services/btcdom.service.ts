import { Injectable } from "@nestjs/common";
import { ConfigService } from "../config";
import { Client } from "@notionhq/client";
import { TradingViewService } from "./tradingview.service";
import { RedisService } from "./redis.service";

type SortDirection = "ascending" | "descending";

@Injectable()
export class BtcDomService {
  private readonly notionClient: Client;
  private readonly databaseId: string;

  constructor(
    private configService: ConfigService,
    private tradingViewService: TradingViewService,
    private redisService: RedisService,
  ) {
    this.notionClient = new Client({
      auth: this.configService.get<string>("notion.api_key"),
    });
    this.databaseId = this.configService.get<string>("notion.btcdom");
  }

  /**
   * Get BTC Dominance data from Notion
   * @param sortField Optional field to sort by
   * @param direction Sort direction ('ascending' or 'descending')
   * @returns BTC Dominance data from Notion
   */
  async getBtcDomData(
    sortField?: string,
    direction: SortDirection = "ascending",
  ) {
    try {
      // Prepare query parameters
      const queryParams: any = {
        database_id: this.databaseId,
      };

      // Add sorting if a sort field is specified
      if (sortField) {
        queryParams.sorts = [
          {
            property: sortField,
            direction,
          },
        ];
      }

      // Query the database with sorting
      const response = await this.notionClient.databases.query(queryParams);
      return this.processNotionData(response.results);
    } catch (error) {
      throw new Error(`Failed to fetch BTC Dominance data: ${error.message}`);
    }
  }

  /**
   * Get temperature indicator raw data
   * @param symbol Symbol to fetch data for (default: OTHERS)
   * @param timeframe Timeframe for data (default: 1D)
   * @param startDate Start date in ISO format (default: 2020-01-01)
   * @param endDate End date in ISO format (default: current date)
   * @returns Raw temperature indicator data array
   */
  async getTemperaturePeriods(
    symbol: string = "OTHERS",
    timeframe: string = "1D",
    startDate: string = "2020-01-01T00:00:00.000Z",
    endDate: string = new Date().toISOString(),
  ) {
    try {
      // Get TradingView session and signature from Redis
      const cookie = await this.redisService.get("cookie");
      if (!cookie) {
        throw new Error("TradingView cookie not found in Redis");
      }

      const { session, signature } =
        this.redisService.parseTradingViewCookie(cookie);

      // Get indicator name from config
      const indicatorName = this.configService.get<string>(
        "tradingview.indicator.temperature",
      );
      if (!indicatorName) {
        throw new Error("TradingView indicator name not configured");
      }

      // Get temperature indicator data for specified symbol
      const temperatureData =
        await this.tradingViewService.getTemperatureIndicator(
          symbol,
          timeframe,
          session,
          signature,
          indicatorName,
          startDate,
          endDate,
        );

      if (!temperatureData || !temperatureData.periods) {
        throw new Error("No temperature data received");
      }

      const periods = temperatureData.periods;
      const startTimestamp = new Date(startDate).getTime();
      const endTimestamp = new Date(endDate).getTime();

      // Filter periods within date range only, return raw data
      const filteredPeriods = periods.filter((period: any) => {
        const periodTimestamp = period["$time"] * 1000; // Convert to milliseconds
        return (
          periodTimestamp >= startTimestamp &&
          periodTimestamp <= endTimestamp
        );
      });

      // Convert to standardized format and sort by time
      const temperatureData_formatted = filteredPeriods
        .map((period: any) => ({
          timestamp: new Date(period["$time"] * 1000).toISOString(),
          value: period["MOScore"],
        }))
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return {
        success: true,
        data: {
          symbol,
          timeframe,
          data: temperatureData_formatted,
          totalDataPoints: temperatureData_formatted.length,
          dateRange: {
            start: startDate,
            end: endDate,
          },
        },
      };
    } catch (error) {
      throw new Error(`Failed to fetch temperature periods: ${error.message}`);
    }
  }



  /**
   * Process and transform Notion database results
   * @param notionData Raw data from Notion API
   * @returns Processed data
   */
  /**
   * Calculate total P&L for a trade record
   * Includes BTC P&L, ALT balance change, and ALT floating P&L
   * @param record The trade record
   * @returns The calculated total P&L
   */
  private calculateTotalPnl(record: any): number | null {
    try {
      // Get required values
      const btcCurrentPrice = parseFloat(record["BTC现价"]);
      const btcEntryPrice = parseFloat(record["BTC初始价格"]);
      const btcPosition = parseFloat(record["BTC仓位"]);
      const altCurrentBalance = parseFloat(record["ALT当前余额(U)"]);
      const altInitialBalance = parseFloat(record["ALT初始余额(U)"]);
      const altFloatingPnl = parseFloat(record["ALT浮动盈亏"]);

      // Validate required values
      if (
        isNaN(btcCurrentPrice) ||
        isNaN(btcEntryPrice) ||
        isNaN(btcPosition) ||
        isNaN(altCurrentBalance) ||
        isNaN(altInitialBalance)
      ) {
        return null;
      }

      // Calculate BTC P&L: (current_price - entry_price) * position
      const btcPnl = (btcCurrentPrice - btcEntryPrice) * btcPosition;

      // Calculate ALT P&L: current_balance - initial_balance
      const altPnl = altCurrentBalance - altInitialBalance;

      // Add ALT floating P&L if available
      const altFloatingPnlValue = !isNaN(altFloatingPnl) ? altFloatingPnl : 0;

      // Total P&L is sum of BTC P&L, ALT P&L, and ALT floating P&L
      const totalPnl = btcPnl + altPnl + altFloatingPnlValue;

      // Round to 2 decimal places
      return Math.round(totalPnl * 100) / 100;
    } catch (error) {
      console.error("Error calculating total P&L:", error);
      return null;
    }
  }

  private processNotionData(notionData: any[]) {
    // Transform Notion's response format into a more usable structure
    return notionData.map((item) => {
      const properties = item.properties;
      const processedItem: any = {};

      // Extract properties based on their type
      Object.keys(properties).forEach((key) => {
        const property = properties[key];

        switch (property.type) {
          case "title":
            processedItem[key] = property.title
              .map((t) => t.plain_text)
              .join("");
            break;
          case "rich_text":
            processedItem[key] = property.rich_text
              .map((t) => t.plain_text)
              .join("");
            break;
          case "number":
            processedItem[key] = property.number;
            break;
          case "select":
            processedItem[key] = property.select?.name;
            break;
          case "multi_select":
            processedItem[key] = property.multi_select.map((s) => s.name);
            break;
          case "date":
            processedItem[key] = property.date?.start;
            break;
          case "checkbox":
            processedItem[key] = property.checkbox;
            break;
          case "status":
            processedItem[key] = property.status?.name;
            break;
          case "formula":
            // Handle formula fields (like 总盈亏)
            if (property.formula?.type === "number") {
              processedItem[key] = property.formula.number;
            } else {
              processedItem[key] = null;
            }
            break;
          default:
            processedItem[key] = null;
        }
      });

      // Calculate and add total P&L
      processedItem["总盈亏"] = this.calculateTotalPnl(processedItem);

      return processedItem;
    });
  }
}
