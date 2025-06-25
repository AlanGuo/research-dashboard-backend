import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type VolumeBacktestDocument = VolumeBacktest & Document;

@Schema({ collection: "volume_backtests" })
export class VolumeBacktest {
  @Prop({ required: true })
  timestamp: Date;

  @Prop({ required: true })
  hour: number; // 小时标识 (0-23)

  @Prop({ type: [Object], required: true })
  rankings: HourlyRankingItem[]; // 合并后的排行榜，按涨跌幅排序（跌幅最大的在前）

  @Prop({ type: [Object], default: [] })
  removedSymbols?: HourlyRankingItem[]; // 从上一期排名中移除的交易对及其当前时间点的数据

  @Prop({ required: true })
  totalMarketVolume: number;

  @Prop({ required: true })
  totalMarketQuoteVolume: number;

  @Prop({ required: true })
  btcPrice: number; // BTC现货价格

  @Prop({ required: true })
  btcPriceChange24h: number; // BTC相对24小时前价格的变化率（百分比）

  @Prop()
  btcdomPrice?: number; // BTCDOM合约价格

  @Prop()
  btcdomPriceChange24h?: number; // BTCDOM相对24小时前价格的变化率（百分比）

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop()
  calculationDuration: number; // 计算耗时(ms)
}

// 资金费率历史项接口
export interface FundingRateHistoryItem {
  fundingTime: Date;
  fundingRate: number;
  markPrice: number | null; // 标记价格，可能为null（当API未返回时）
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
  futureSymbol?: string; // 对应的期货交易对symbol（如果与现货不同）
  futurePriceAtTime?: number; // 期货价格（当前时间点）
  fundingRateHistory?: FundingRateHistoryItem[]; // 对应时间段的资金费率历史
  currentFundingRate?: FundingRateHistoryItem[]; // 当期可用的资金费率数组（用于选股评分）
}

export const VolumeBacktestSchema =
  SchemaFactory.createForClass(VolumeBacktest);

// 创建优化索引
// 1. 主查询索引：时间范围查询 + 排序
VolumeBacktestSchema.index({ timestamp: 1 });

// 2. 复合索引：时间 + 小时 (用于精确查询)
VolumeBacktestSchema.index({ timestamp: 1, hour: 1 });

// 3. 复合索引：交易对 + 时间 (用于特定交易对的历史查询)
VolumeBacktestSchema.index({ "rankings.symbol": 1, timestamp: 1 });

// 4. 复合索引：时间 + BTC价格 (用于价格相关查询)
VolumeBacktestSchema.index({ timestamp: 1, btcPrice: 1 });

// 5. 复合索引：时间 + BTCDOM价格 (用于BTCDOM价格相关查询)
VolumeBacktestSchema.index({ timestamp: 1, btcdomPrice: 1 });

// 6. 稀疏索引：创建时间 (用于数据管理)
VolumeBacktestSchema.index({ createdAt: 1 }, { sparse: true });
