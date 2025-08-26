import { IsOptional, IsString, IsDateString, IsNumberString } from "class-validator";
import { Transform } from "class-transformer";

/**
 * 交易日志查询DTO
 */
export class Btcdom2TradingLogsQueryDto {
  @IsOptional()
  @IsDateString({}, { message: "开始时间戳必须是有效的ISO日期格式" })
  startTimestamp?: string;

  @IsOptional()
  @IsDateString({}, { message: "结束时间戳必须是有效的ISO日期格式" })
  endTimestamp?: string;

  @IsOptional()
  @IsDateString({}, { message: "市场数据时间戳必须是有效的ISO日期格式" })
  marketDataTimestamp?: string;
}

/**
 * 交易日志响应DTO
 */
export interface Btcdom2TradingLogsResponse {
  success: boolean;
  data: Btcdom2TradingLogEntry[];
  count: number;
  query?: {
    startTimestamp?: string;
    endTimestamp?: string;
    marketDataTimestamp?: string;
  };
}

/**
 * 交易日志条目DTO
 */
export interface Btcdom2TradingLogEntry {
  _id?: string;
  order_id: string;
  action: string;
  error_message: string | null;
  execution_id: string;
  fee: number;
  fee_asset: string;
  fee_usdt_value: number;
  market_data_timestamp: Date | string;
  price: number;
  quantity: number;
  side: string;
  status: string;
  symbol: string;
  target_quantity: number;
  timestamp: string;
}

/**
 * 交易日志统计响应DTO
 */
export interface Btcdom2TradingLogsStatisticsResponse {
  success: boolean;
  data: {
    totalRecords: number;
    successfulTrades: number;
    dateRange: {
      earliest: Date | null;
      latest: Date | null;
    };
  };
}