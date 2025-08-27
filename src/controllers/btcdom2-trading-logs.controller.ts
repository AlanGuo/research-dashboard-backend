import {
  Controller,
  Get,
  Query,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Btcdom2TradingLogsService } from "../services/btcdom2-trading-logs.service";
import {
  Btcdom2TradingLogsQueryDto,
  Btcdom2TradingLogsResponse,
  Btcdom2TradingLogsStatisticsResponse
} from "../dto/btcdom2-trading-logs.dto";

@Controller("/v1/btcdom2/trading-logs")
export class Btcdom2TradingLogsController {
  private readonly logger = new Logger(Btcdom2TradingLogsController.name);

  constructor(
    private readonly btcdom2TradingLogsService: Btcdom2TradingLogsService,
  ) {}

  /**
   * 获取btcdom2交易日志数据
   * GET /v1/btcdom2/trading-logs
   * 
   * 查询参数:
   * - startTimestamp: 开始时间戳 (ISO格式, 可选)
   * - endTimestamp: 结束时间戳 (ISO格式, 可选)
   * - marketDataTimestamp: 精确的市场数据时间戳 (ISO格式, 可选)
   */
  @Get()
  async getTradingLogs(
    @Query("startTimestamp") startTimestamp?: string,
    @Query("endTimestamp") endTimestamp?: string,
    @Query("marketDataTimestamp") marketDataTimestamp?: string,
  ): Promise<Btcdom2TradingLogsResponse> {
    try {
      let data;

      // 如果提供了精确的市场数据时间戳，使用精确查询
      if (marketDataTimestamp) {
        const marketDataDate = new Date(marketDataTimestamp);
        if (isNaN(marketDataDate.getTime())) {
          throw new HttpException(
            "无效的市场数据时间戳格式，请使用ISO格式 (例如: 2025-07-27T08:00:00.000Z)",
            HttpStatus.BAD_REQUEST,
          );
        }

        data = await this.btcdom2TradingLogsService.getTradingLogsByExactMarketDataTimestamp(marketDataDate);

        return {
          success: true,
          data,
          count: data.length,
          query: {
            marketDataTimestamp: marketDataDate.toISOString(),
          },
        };
      }

      // 如果提供了时间范围，使用范围查询
      if (startTimestamp || endTimestamp) {
        // 解析日期参数
        let startDateObj: Date | undefined;
        let endDateObj: Date | undefined;

        if (startTimestamp) {
          startDateObj = new Date(startTimestamp);
          if (isNaN(startDateObj.getTime())) {
            throw new HttpException(
              "无效的开始时间戳格式，请使用ISO格式 (例如: 2025-07-27T00:00:00.000Z)",
              HttpStatus.BAD_REQUEST,
            );
          }
        }

        if (endTimestamp) {
          endDateObj = new Date(endTimestamp);
          if (isNaN(endDateObj.getTime())) {
            throw new HttpException(
              "无效的结束时间戳格式，请使用ISO格式 (例如: 2025-07-27T23:59:59.999Z)",
              HttpStatus.BAD_REQUEST,
            );
          }
        }

        // 验证日期范围
        if (startDateObj && endDateObj && startDateObj >= endDateObj) {
          throw new HttpException(
            "结束时间戳必须大于开始时间戳",
            HttpStatus.BAD_REQUEST,
          );
        }

        // 如果只提供了一个时间点，设置默认范围
        if (startDateObj && !endDateObj) {
          // 如果只有开始时间，结束时间设为开始时间的下一天
          endDateObj = new Date(startDateObj.getTime() + 24 * 60 * 60 * 1000);
        }
        if (endDateObj && !startDateObj) {
          // 如果只有结束时间，开始时间设为结束时间的前一天
          startDateObj = new Date(endDateObj.getTime() - 24 * 60 * 60 * 1000);
        }

        if (!startDateObj || !endDateObj) {
          throw new HttpException(
            "必须提供时间范围或精确的市场数据时间戳",
            HttpStatus.BAD_REQUEST,
          );
        }

        data = await this.btcdom2TradingLogsService.getTradingLogsByMarketDataTimestamp(
          startDateObj,
          endDateObj,
        );

        return {
          success: true,
          data,
          count: data.length,
          query: {
            startTimestamp: startDateObj.toISOString(),
            endTimestamp: endDateObj.toISOString(),
          },
        };
      }

      // 如果没有提供任何查询参数，返回错误
      throw new HttpException(
        "必须提供查询参数：startTimestamp + endTimestamp 或 marketDataTimestamp",
        HttpStatus.BAD_REQUEST,
      );

    } catch (error) {
      this.logger.error("获取btcdom2交易日志失败:", error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        error.message || "获取btcdom2交易日志失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取交易日志统计信息
   * GET /v1/btcdom2/trading-logs/statistics
   */
  @Get("statistics")
  async getTradingLogsStatistics(): Promise<Btcdom2TradingLogsStatisticsResponse> {
    try {
      const statistics = await this.btcdom2TradingLogsService.getTradingLogsStatistics();

      return {
        success: true,
        data: statistics,
      };
    } catch (error) {
      this.logger.error("获取交易日志统计信息失败:", error);
      
      throw new HttpException(
        error.message || "获取交易日志统计信息失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}