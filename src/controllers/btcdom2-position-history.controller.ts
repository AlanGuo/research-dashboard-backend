import {
  Controller,
  Get,
  Query,
  Logger,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Btcdom2PositionHistoryService } from "../services/btcdom2-position-history.service";

@Controller("/v1/btcdom2/position-history")
export class Btcdom2PositionHistoryController {
  private readonly logger = new Logger(Btcdom2PositionHistoryController.name);

  constructor(
    private readonly btcdom2PositionHistoryService: Btcdom2PositionHistoryService,
  ) {}

  /**
   * 根据市值数据时间戳获取持仓历史数据
   * GET /v1/btcdom2/position-history/by-timestamp?marketDataTimestamp=2025-08-29T08:00:00.000Z
   */
  @Get("/by-timestamp")
  async getPositionByTimestamp(
    @Query("marketDataTimestamp") marketDataTimestamp?: string,
  ) {
    try {
      this.logger.log(`获取btcdom2持仓历史请求: marketDataTimestamp=${marketDataTimestamp}`);

      if (!marketDataTimestamp) {
        throw new HttpException(
          "marketDataTimestamp参数是必需的",
          HttpStatus.BAD_REQUEST,
        );
      }

      // 解析时间戳参数
      const timestampObj = new Date(marketDataTimestamp);
      if (isNaN(timestampObj.getTime())) {
        throw new HttpException(
          "无效的时间戳格式，请使用ISO格式 (例如: 2025-08-29T08:00:00.000Z)",
          HttpStatus.BAD_REQUEST,
        );
      }

      const data = await this.btcdom2PositionHistoryService.getPositionByMarketDataTimestamp(
        timestampObj
      );

      return {
        success: true,
        data,
        query: {
          marketDataTimestamp: timestampObj.toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("获取btcdom2持仓历史数据失败:", error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        error.message || "获取btcdom2持仓历史数据失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取持仓历史数据 - 支持时间范围查询
   * GET /v1/btcdom2/position-history
   * 
   * 查询参数:
   * - startDate: 开始日期 (ISO格式, 可选)
   * - endDate: 结束日期 (ISO格式, 可选)
   * - sortBy: 排序字段 (默认: market_data_timestamp)
   * - sortOrder: 排序方向 asc/desc (默认: desc)
   * - limit: 限制返回数量 (可选)
   */
  @Get()
  async getPositionHistory(
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("limit") limit?: string,
  ) {
    try {
      this.logger.log(`获取btcdom2持仓历史数据请求: startDate=${startDate}, endDate=${endDate}, sortBy=${sortBy}, sortOrder=${sortOrder}, limit=${limit}`);

      // 解析日期参数
      let startDateObj: Date | undefined;
      let endDateObj: Date | undefined;

      if (startDate) {
        startDateObj = new Date(startDate);
        if (isNaN(startDateObj.getTime())) {
          throw new HttpException(
            "无效的开始日期格式，请使用ISO格式 (例如: 2025-06-01T00:00:00.000Z)",
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      if (endDate) {
        endDateObj = new Date(endDate);
        if (isNaN(endDateObj.getTime())) {
          throw new HttpException(
            "无效的结束日期格式，请使用ISO格式 (例如: 2025-06-30T23:59:59.999Z)",
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // 验证日期范围
      if (startDateObj && endDateObj && startDateObj > endDateObj) {
        throw new HttpException(
          "结束日期不能早于开始日期",
          HttpStatus.BAD_REQUEST,
        );
      }

      // 解析限制数量
      let limitNum: number | undefined;
      if (limit) {
        limitNum = parseInt(limit, 10);
        if (isNaN(limitNum) || limitNum <= 0) {
          throw new HttpException(
            "限制数量必须是正整数",
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const data = await this.btcdom2PositionHistoryService.getPositionHistory(
        startDateObj,
        endDateObj,
        sortBy || 'market_data_timestamp',
        sortOrder || 'desc',
        limitNum,
      );

      return {
        success: true,
        data,
        count: data.length,
        query: {
          startDate: startDateObj?.toISOString(),
          endDate: endDateObj?.toISOString(),
          sortBy: sortBy || 'market_data_timestamp',
          sortOrder: sortOrder || 'desc',
          limit: limitNum,
        },
      };
    } catch (error) {
      this.logger.error("获取btcdom2持仓历史数据失败:", error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        error.message || "获取btcdom2持仓历史数据失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}