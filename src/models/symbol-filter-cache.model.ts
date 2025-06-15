import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SymbolFilterCacheDocument = SymbolFilterCache & Document;

@Schema({ timestamps: true })
export class SymbolFilterCache {
  @Prop({ required: true, unique: true })
  filterHash: string; // 筛选条件的哈希值，用于快速查找

  @Prop({ type: Object, required: true })
  filterCriteria: {
    referenceTime: string; // 参考时间点
    quoteAsset?: string;
    minVolumeThreshold: number;
    minHistoryDays: number;
    requireFutures: boolean;
    excludeStablecoins: boolean;
    includeInactive: boolean;
  };

  @Prop({ type: [String], required: true })
  validSymbols: string[]; // 符合条件的交易对列表

  @Prop({ type: [String], required: true })
  invalidSymbols: string[]; // 不符合条件的交易对列表

  @Prop({ type: Object, required: true })
  invalidReasons: { [symbol: string]: string[] }; // 不符合条件的原因

  @Prop({ type: Object, required: true })
  statistics: {
    totalDiscovered: number;
    validSymbols: number;
    invalidSymbols: number;
    validRate: string;
    reasonStats: { [reason: string]: number };
  };

  @Prop({ required: true })
  processingTime: number; // 筛选耗时（毫秒）

  @Prop({ default: Date.now })
  createdAt: Date;

  @Prop({ default: Date.now })
  lastUsedAt: Date; // 最后使用时间，用于缓存清理

  @Prop({ default: 1 })
  hitCount: number; // 命中次数
}

export const SymbolFilterCacheSchema = SchemaFactory.createForClass(SymbolFilterCache);

// 创建索引（filterHash已通过unique: true自动创建索引，无需重复定义）
SymbolFilterCacheSchema.index({ createdAt: 1 });
SymbolFilterCacheSchema.index({ lastUsedAt: 1 });
