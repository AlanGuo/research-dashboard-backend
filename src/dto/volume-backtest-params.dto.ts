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
  @IsNumber()
  @Min(30)
  @Max(730)
  @Transform(({ value }) => parseInt(value))
  minHistoryDays?: number = 365; // 最少历史数据天数，默认365天（1年）

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  @Transform(({ value }) => parseInt(value))
  granularityHours?: number = 8; // 回测粒度（小时），默认8小时
}

export class VolumeBacktestQueryDto {
  @IsOptional()
  @IsDateString()
  startTime?: string; // 自定义开始时间 (ISO 8601 格式)

  @IsOptional()
  @IsDateString()
  endTime?: string; // 自定义结束时间 (ISO 8601 格式)

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(24)
  @Transform(({ value }) => parseInt(value))
  granularityHours?: number = 8; // 回测粒度（小时），用于显示
}

export interface VolumeBacktestResponse {
  success: boolean;
  granularityHours: number; // 回测时间段（小时），放在外层
  data: {
    timestamp: string;
    hour: number;
    rankings: HourlyRankingItem[]; // 合并后的排行榜，按涨跌幅排序（跌幅最大的在前）
    removedSymbols: HourlyRankingItem[]; // 从上一期排名中移除的交易对及其当前时间点的数据
    btcPrice: number; // BTC现货价格
    btcPriceChange24h: number; // BTC相对24小时前价格的变化率（百分比）
    marketStats: {
      totalVolume: number;
      totalQuoteVolume: number;
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
        minHistoryDays: number
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
  priceAtTime: number;
  volumeChangePercent: number;
}

export interface HourlyPriceChangeRankingItem {
  rank: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  priceChange24h: number; // 24小时价格变化百分比（负数表示跌幅，跌幅最大的排在前面）
  priceAtTime: number; // 当前价格
  price24hAgo: number; // 24小时前价格
  volume24h: number; // 过去24小时成交量
  quoteVolume24h: number; // 过去24小时成交金额
}

export interface HourlyVolatilityRankingItem {
  rank: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  volatility24h: number; // 24小时波动率百分比（高低价差/最低价*100，波动率高的排在前面）
  high24h: number; // 24小时最高价
  low24h: number; // 24小时最低价
  priceAtTime: number; // 当前价格
  volume24h: number; // 过去24小时成交量
  quoteVolume24h: number; // 过去24小时成交金额
}

// 资金费率历史项接口
export interface FundingRateHistoryItem {
  fundingTime: Date;
  fundingRate: number;
  markPrice: number;
}

// 合并排行榜项接口 - 包含价格变化、成交量和波动率信息
export interface HourlyRankingItem {
  rank: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  priceChange24h: number; // 24小时价格变化百分比（负数表示跌幅）
  priceAtTime: number; // 当前价格（现货）
  price24hAgo: number; // 24小时前价格
  volume24h: number; // 过去24小时成交量
  quoteVolume24h: number; // 过去24小时成交金额
  marketShare: number; // 市场份额百分比
  volatility24h: number; // 24小时波动率百分比
  high24h: number; // 24小时最高价
  low24h: number; // 24小时最低价
  futurePriceAtTime?: number; // 期货价格（当前时间点）
  fundingRateHistory?: FundingRateHistoryItem[]; // 对应时间段的资金费率历史
}
