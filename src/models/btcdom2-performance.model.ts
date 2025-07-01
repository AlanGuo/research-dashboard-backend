import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type Btcdom2PerformanceDocument = Btcdom2Performance & Document;

@Schema({ 
  collection: "btcdom2_performance",
  timestamps: false // 使用自定义的timestamp字段
})
export class Btcdom2Performance {
  @Prop({ required: true })
  timestamp: Date; // 记录时间戳

  @Prop({ required: true })
  position_pnl: number; // 持仓盈亏

  @Prop({ required: true })
  btc_pnl: number; // BTC盈亏

  @Prop({ required: true })
  futures_pnl: number; // 期货盈亏

  @Prop({ required: true })
  total_fees_usdt: number; // 总手续费(USDT)

  @Prop({ required: true })
  total_funding_fee_usdt: number; // 总资金费率费用(USDT)

  @Prop({ required: true })
  total_pnl: number; // 总盈亏

  @Prop({ required: true })
  total_return_rate: number; // 总收益率

  @Prop({ required: true })
  total_trades: number; // 总交易次数

  @Prop({ required: true })
  positions_count: number; // 持仓数量

  @Prop({ required: true })
  market_data_timestamp: Date; // 市场数据时间戳

  @Prop({ required: true })
  execution_id: string; // 执行ID
}

export const Btcdom2PerformanceSchema = SchemaFactory.createForClass(Btcdom2Performance);

// 创建索引
// 1. 主查询索引：按时间排序
Btcdom2PerformanceSchema.index({ timestamp: 1 });

// 2. 市场数据时间戳索引：用于按市场数据时间筛选
Btcdom2PerformanceSchema.index({ market_data_timestamp: 1 });

// 3. 复合索引：市场数据时间戳 + 时间戳
Btcdom2PerformanceSchema.index({ market_data_timestamp: 1, timestamp: 1 });

// 4. 执行ID索引：用于查找特定执行的记录
Btcdom2PerformanceSchema.index({ execution_id: 1 });
