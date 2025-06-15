import {
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  IsDateString,
  Min,
  Max,
} from "class-validator";
import { Transform } from "class-transformer";

export class VolumeBacktestParamsDto {
  @IsDateString()
  startTime: string; // ISO 8601 格式时间

  @IsDateString()
  endTime: string; // ISO 8601 格式时间

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symbols?: string[]; // 指定交易对，为空则获取所有活跃交易对

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(200)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 50; // 排行榜数量，默认50

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Transform(({ value }) => parseFloat(value))
  minVolumeThreshold?: number = 10000; // 最小成交金额阈值，过滤小币种

  @IsOptional()
  @IsString()
  quoteAsset?: string = "USDT"; // 基准计价货币，默认USDT

  @IsOptional()
  @Transform(({ value }) => value === "true")
  includeInactive?: boolean = false; // 是否包含非活跃交易对

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(730)
  @Transform(({ value }) => parseInt(value))
  minHistoryDays?: number = 365; // 最少历史数据天数，默认365天（1年）

  @IsOptional()
  @Transform(({ value }) => value === "true")
  requireFutures?: boolean = false; // 是否要求有期货合约可做空

  @IsOptional()
  @Transform(({ value }) => value === "true")
  excludeStablecoins?: boolean = true; // 是否排除稳定币，默认排除

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  @Transform(({ value }) => parseInt(value))
  granularityHours?: number = 8; // 回测粒度（小时），默认8小时

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  @Transform(({ value }) => parseInt(value))
  concurrency?: number = 5; // 筛选并发数量，默认5个并发任务
}

export class VolumeBacktestQueryDto {
  @IsOptional()
  @IsDateString()
  date?: string; // 查询特定日期的数据

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(23)
  @Transform(({ value }) => parseInt(value))
  hour?: number; // 查询特定小时的数据

  @IsOptional()
  @IsString()
  symbol?: string; // 查询特定交易对的历史排名

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 50;
}

export interface VolumeBacktestResponse {
  success: boolean;
  data: {
    timestamp: string;
    hour: number;
    rankings: HourlyVolumeRankingItem[];
    marketStats: {
      totalVolume: number;
      totalQuoteVolume: number;
      activePairs: number;
      topMarketConcentration: number; // 前10名市场集中度
    };
    calculationTime: number;
  }[];
  meta: {
    startTime: string;
    endTime: string;
    totalHours: number;
    dataPoints: number;
    processingTime: number;
    weeklyCalculations?: number;
    symbolStats?: {
      totalDiscovered: number;
      validSymbols: number;
      invalidSymbols: number;
      validRate: string;
      weeklyBreakdown?: {
        weekStart: string;
        validSymbols: number;
        invalidSymbols: number;
        validRate: string;
        sampleSymbols: string[];
      }[];
      filterCriteria: {
        minHistoryDays: number;
        requireFutures: boolean;
        excludeStablecoins: boolean;
      };
      invalidReasons?: { [reason: string]: number };
    };
  };
}

export interface HourlyVolumeRankingItem {
  rank: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  volume24h: number;
  quoteVolume24h: number;
  marketShare: number;
  hourlyChange: number;
  priceAtTime: number;
  volumeChangePercent: number;
}
