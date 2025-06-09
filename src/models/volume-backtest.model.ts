import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type VolumeBacktestDocument = VolumeBacktest & Document;

@Schema({ collection: 'volume_backtests' })
export class VolumeBacktest {
  @Prop({ required: true })
  timestamp: Date;

  @Prop({ required: true })
  hour: number; // 小时标识 (0-23)

  @Prop({ type: [Object], required: true })
  rankings: HourlyVolumeRankingItem[];

  @Prop({ required: true })
  totalMarketVolume: number;

  @Prop({ required: true })
  totalMarketQuoteVolume: number;

  @Prop({ required: true })
  activePairs: number;

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop()
  calculationDuration: number; // 计算耗时(ms)
}

export interface HourlyVolumeRankingItem {
  rank: number;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  volume24h: number; // 过去24小时成交量
  quoteVolume24h: number; // 过去24小时成交金额
  marketShare: number; // 市场份额百分比
  hourlyChange: number; // 与上一小时排名变化
  priceAtTime: number; // 当时价格
  volumeChangePercent: number; // 成交量变化百分比
}

export const VolumeBacktestSchema = SchemaFactory.createForClass(VolumeBacktest);

// 创建索引
VolumeBacktestSchema.index({ timestamp: 1 });
VolumeBacktestSchema.index({ hour: 1 });
VolumeBacktestSchema.index({ 'rankings.symbol': 1 });
