import { Schema, model } from 'mongoose';

// 单个趋势期间的资产表现
export interface AssetPerformance {
  periodId: string;  // 趋势期间ID，格式为 startDate_endDate
  startDate: string; // 开始日期
  endDate: string;   // 结束日期
  trend: 'up' | 'down'; // 趋势方向
  change: number;    // 涨跌幅度（百分比）
  startPrice?: number; // 起始价格
  endPrice?: number;   // 结束价格
}

// 资产趋势表现数据
export interface AssetTrend {
  assetId: string;      // 资产ID
  assetName: string;    // 资产名称
  assetSymbol: string;  // 资产交易符号
  category: string;     // 资产类别
  performances: AssetPerformance[]; // 在各个趋势期间的表现
  lastUpdated: Date;    // 最后更新时间
}

// 创建 Schema
const AssetPerformanceSchema = new Schema<AssetPerformance>({
  periodId: { type: String, required: true },
  startDate: { type: String, required: true },
  endDate: { type: String, required: true },
  trend: { type: String, enum: ['up', 'down'], required: true },
  change: { type: Number, required: true },
  startPrice: { type: Number },
  endPrice: { type: Number }
});

const AssetTrendSchema = new Schema<AssetTrend>({
  assetId: { type: String, required: true, index: true },
  assetName: { type: String, required: true },
  assetSymbol: { type: String, required: true },
  category: { type: String, required: true },
  performances: [AssetPerformanceSchema],
  lastUpdated: { type: Date, default: Date.now }
});

// 创建复合索引，确保每个资产只有一条记录
// AssetTrendSchema.index({ assetId: 1 }, { unique: true });

// 创建模型
export const AssetTrendModel = model<AssetTrend>(
  'AssetTrend', 
  AssetTrendSchema
);

// 响应接口
export interface AssetTrendResponse {
  success: boolean;
  data: AssetTrend[] | AssetTrend;
  timestamp: string;
  message?: string;
}
