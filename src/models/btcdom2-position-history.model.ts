import { Schema, Document } from 'mongoose';

// BTC持仓信息
export interface BtcPosition {
  symbol: string;
  quantity: number;
  avg_price: number;
  value: number;
  unrealized_pnl: number;
}

// 做空持仓信息
export interface ShortPosition {
  symbol: string;
  quantity: number;
  avg_price: number;
  value: number;
  unrealized_pnl: number;
}

// 持仓信息
export interface Positions {
  btc: BtcPosition;
  shorts: ShortPosition[];
  spot_usdt_balance: number;
  futures_usdt_balance: number;
}

// 主文档接口
export interface Btcdom2PositionHistory extends Document {
  timestamp: string;
  market_data_timestamp: Date;
  execution_id: string;
  positions: Positions;
}

// BTC持仓Schema
const BtcPositionSchema = new Schema({
  symbol: { type: String, required: true },
  quantity: { type: Number, required: true },
  avg_price: { type: Number, required: true },
  value: { type: Number, required: true },
  unrealized_pnl: { type: Number, required: true }
}, { _id: false });

// 做空持仓Schema
const ShortPositionSchema = new Schema({
  symbol: { type: String, required: true },
  quantity: { type: Number, required: true },
  avg_price: { type: Number, required: true },
  value: { type: Number, required: true },
  unrealized_pnl: { type: Number, required: true }
}, { _id: false });

// 持仓信息Schema
const PositionsSchema = new Schema({
  btc: { type: BtcPositionSchema, required: true },
  shorts: { type: [ShortPositionSchema], required: true },
  spot_usdt_balance: { type: Number, required: true },
  futures_usdt_balance: { type: Number, required: true }
}, { _id: false });

// 主文档Schema
export const Btcdom2PositionHistorySchema = new Schema({
  timestamp: { type: String, required: true },
  market_data_timestamp: { type: Date, required: true, index: true },
  execution_id: { type: String, required: true },
  positions: { type: PositionsSchema, required: true }
}, {
  timestamps: false,
  collection: 'btcdom2_position_history'
});

// 创建索引
Btcdom2PositionHistorySchema.index({ market_data_timestamp: -1 });
Btcdom2PositionHistorySchema.index({ execution_id: 1 });