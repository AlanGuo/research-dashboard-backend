import {
  Controller,
  Get,
  Query,
  Logger,
  HttpException,
  HttpStatus,
  Param,
} from "@nestjs/common";
import { Btcdom2PerformanceService } from "../services/btcdom2-performance.service";
import {
  Btcdom2PerformanceQueryDto,
  Btcdom2PerformanceByMarketTimestampDto,
  Btcdom2PerformanceLatestDto,
  Btcdom2PerformanceResponse
} from "../dto/btcdom2-performance.dto";

@Controller("/v1/btcdom2/performance")
export class Btcdom2PerformanceController {
  private readonly logger = new Logger(Btcdom2PerformanceController.name);

  constructor(
    private readonly btcdom2PerformanceService: Btcdom2PerformanceService,
  ) {}

  /**
   * 获取所有btcdom2策略表现数据
   * GET /v1/btcdom2/performance
   * 
   * 查询参数:
   * - startDate: 开始日期 (ISO格式, 可选)
   * - endDate: 结束日期 (ISO格式, 可选)
   * - sortBy: 排序字段 (默认: market_data_timestamp)
   * - sortOrder: 排序方向 asc/desc (默认: desc)
   * - limit: 限制返回数量 (可选)
   */
  @Get()
  async getAllPerformanceData(
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("limit") limit?: string,
  ) {
    try {
      this.logger.log(`获取btcdom2表现数据请求: startDate=${startDate}, endDate=${endDate}, sortBy=${sortBy}, sortOrder=${sortOrder}, limit=${limit}`);

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
      if (startDateObj && endDateObj && startDateObj >= endDateObj) {
        throw new HttpException(
          "结束日期必须大于开始日期",
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

      const data = await this.btcdom2PerformanceService.getAllPerformanceData(
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
      this.logger.error("获取btcdom2表现数据失败:", error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        error.message || "获取btcdom2表现数据失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 根据市场数据时间戳范围获取表现数据
   * GET /v1/btcdom2/performance/by-market-timestamp
   * 
   * 查询参数:
   * - startTimestamp: 开始时间戳 (ISO格式, 必需)
   * - endTimestamp: 结束时间戳 (ISO格式, 必需)
   */
  @Get("by-market-timestamp")
  async getPerformanceByMarketDataTimestamp(
    @Query("startTimestamp") startTimestamp: string,
    @Query("endTimestamp") endTimestamp: string,
  ) {
    try {
      if (!startTimestamp || !endTimestamp) {
        throw new HttpException(
          "开始时间戳和结束时间戳都是必需的",
          HttpStatus.BAD_REQUEST,
        );
      }

      const startDate = new Date(startTimestamp);
      const endDate = new Date(endTimestamp);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new HttpException(
          "无效的时间戳格式，请使用ISO格式",
          HttpStatus.BAD_REQUEST,
        );
      }

      if (startDate >= endDate) {
        throw new HttpException(
          "结束时间戳必须大于开始时间戳",
          HttpStatus.BAD_REQUEST,
        );
      }

      const data = await this.btcdom2PerformanceService.getPerformanceByMarketDataTimestamp(
        startDate,
        endDate,
      );

      return {
        success: true,
        data,
        count: data.length,
        query: {
          startTimestamp: startDate.toISOString(),
          endTimestamp: endDate.toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("根据市场数据时间戳获取表现数据失败:", error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        error.message || "根据市场数据时间戳获取表现数据失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取最新的表现数据
   * GET /v1/btcdom2/performance/latest
   * 
   * 查询参数:
   * - count: 获取最新的几条数据 (默认: 1)
   */
  @Get("latest")
  async getLatestPerformanceData(@Query("count") count?: string) {
    try {
      let countNum = 1;
      if (count) {
        countNum = parseInt(count, 10);
        if (isNaN(countNum) || countNum <= 0) {
          throw new HttpException(
            "数量必须是正整数",
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const data = await this.btcdom2PerformanceService.getLatestPerformanceData(countNum);

      return {
        success: true,
        data,
        count: data.length,
      };
    } catch (error) {
      this.logger.error("获取最新表现数据失败:", error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        error.message || "获取最新表现数据失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取表现数据统计信息
   * GET /v1/btcdom2/performance/statistics
   */
  @Get("statistics")
  async getPerformanceStatistics() {
    try {
      const statistics = await this.btcdom2PerformanceService.getPerformanceStatistics();

      return {
        success: true,
        data: statistics,
      };
    } catch (error) {
      this.logger.error("获取表现统计信息失败:", error);
      
      throw new HttpException(
        error.message || "获取表现统计信息失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 根据执行ID获取表现数据
   * GET /v1/btcdom2/performance/execution/:executionId
   */
  @Get("execution/:executionId")
  async getPerformanceByExecutionId(@Param("executionId") executionId: string) {
    try {
      if (!executionId) {
        throw new HttpException(
          "执行ID是必需的",
          HttpStatus.BAD_REQUEST,
        );
      }

      const data = await this.btcdom2PerformanceService.getPerformanceByExecutionId(executionId);

      if (!data) {
        throw new HttpException(
          `未找到执行ID为 ${executionId} 的表现数据`,
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data,
      };
    } catch (error) {
      this.logger.error(`根据执行ID ${executionId} 获取表现数据失败:`, error);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        error.message || "根据执行ID获取表现数据失败",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
