import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type Btcdom2TradingLogsDocument = Btcdom2TradingLogs & Document;

@Schema({ 
  collection: "btcdom2_trading_logs",
  timestamps: false // 使用自定义的timestamp字段
})
export class Btcdom2TradingLogs {
  @Prop({ required: true })
  order_id: string; // 订单ID

  @Prop({ required: true })
  action: string; // 动作类型 (FILL等)

  @Prop({ required: false })
  error_message: string | null; // 错误信息

  @Prop({ required: true })
  execution_id: string; // 执行ID

  @Prop({ required: true })
  fee: number; // 手续费

  @Prop({ required: true })
  fee_asset: string; // 手续费资产

  @Prop({ required: true })
  fee_usdt_value: number; // 手续费USDT价值

  @Prop({ required: true })
  market_data_timestamp: Date; // 市场数据时间戳

  @Prop({ required: true })
  price: number; // 价格

  @Prop({ required: true })
  quantity: number; // 数量

  @Prop({ required: true })
  side: string; // 交易方向 (FUTURES等)

  @Prop({ required: true })
  status: string; // 状态 (SUCCESS等)

  @Prop({ required: true })
  symbol: string; // 交易对符号

  @Prop({ required: true })
  target_quantity: number; // 目标数量

  @Prop({ required: true })
  timestamp: string; // 时间戳
}

export const Btcdom2TradingLogsSchema = SchemaFactory.createForClass(Btcdom2TradingLogs);

// 创建索引
// 1. 市场数据时间戳索引：用于按期数筛选
Btcdom2TradingLogsSchema.index({ market_data_timestamp: 1 });

// 2. 复合索引：市场数据时间戳 + 交易对
Btcdom2TradingLogsSchema.index({ market_data_timestamp: 1, symbol: 1 });

// 3. 复合索引：市场数据时间戳 + 动作
Btcdom2TradingLogsSchema.index({ market_data_timestamp: 1, action: 1 });

// 4. 状态索引：用于筛选成功的交易
Btcdom2TradingLogsSchema.index({ status: 1 });