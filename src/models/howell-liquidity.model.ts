export interface HowellLiquidityDataPoint {
  date: string;                  // 日期，格式为 YYYY-MM-DD, 会调整为每周一
  rawDate?: string;              // 原始日期，格式为 YYYY-MM-DD
  globalLiquidity: number;       // 全球流动性（单位：万亿）
  shadowMonetaryBase: number;    // Shadow Monetary Base
  collateralMultiplier: number;  // Collateral Multiplier
  isRevised: boolean;            // 是否为修正后的数据
}

export interface HowellLiquidityResponse {
  success: boolean;
  data?: HowellLiquidityDataPoint[];
  error?: string;
  timestamp: string;
  message?: string;
}
