import { IsOptional, IsString, IsNumber, IsArray, IsDateString, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

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
  quoteAsset?: string = 'USDT'; // 基准计价货币，默认USDT

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  includeInactive?: boolean = false; // 是否包含非活跃交易对
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
