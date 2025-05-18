import { Injectable } from '@nestjs/common';
import { HowellLiquidityDataPoint, HowellLiquidityResponse } from '../models/howell-liquidity.model';

@Injectable()
export class HowellLiquidityService {
  // 存储表格中的数据
  private readonly liquidityData: HowellLiquidityDataPoint[] = [
    // 月度数据（已修正）
    { date: '2024-01', globalLiquidity: 170.28, shadowMonetaryBase: 98.62, collateralMultiplier: 1.73, isRevised: true },
    { date: '2024-02', globalLiquidity: 170.32, shadowMonetaryBase: 98.94, collateralMultiplier: 1.72, isRevised: true },
    { date: '2024-03', globalLiquidity: 169.85, shadowMonetaryBase: 98.64, collateralMultiplier: 1.72, isRevised: true },
    { date: '2024-04', globalLiquidity: 169.13, shadowMonetaryBase: 98.40, collateralMultiplier: 1.72, isRevised: true },
    { date: '2024-05', globalLiquidity: 170.16, shadowMonetaryBase: 100.00, collateralMultiplier: 1.70, isRevised: true },
    { date: '2024-06', globalLiquidity: 169.86, shadowMonetaryBase: 99.40, collateralMultiplier: 1.71, isRevised: true },
    { date: '2024-07', globalLiquidity: 171.57, shadowMonetaryBase: 101.90, collateralMultiplier: 1.68, isRevised: true },
    { date: '2024-08', globalLiquidity: 173.94, shadowMonetaryBase: 105.47, collateralMultiplier: 1.65, isRevised: true },
    { date: '2024-09', globalLiquidity: 175.82, shadowMonetaryBase: 106.99, collateralMultiplier: 1.64, isRevised: true },
    { date: '2024-10', globalLiquidity: 173.83, shadowMonetaryBase: 104.49, collateralMultiplier: 1.66, isRevised: true },
    { date: '2024-11', globalLiquidity: 172.82, shadowMonetaryBase: 104.04, collateralMultiplier: 1.66, isRevised: true },
    { date: '2024-12', globalLiquidity: 173.07, shadowMonetaryBase: 102.38, collateralMultiplier: 1.67, isRevised: true },
    { date: '2025-01', globalLiquidity: 172.23, shadowMonetaryBase: 103.85, collateralMultiplier: 1.66, isRevised: true },
    { date: '2025-02', globalLiquidity: 173.50, shadowMonetaryBase: 105.00, collateralMultiplier: 1.65, isRevised: true },
    { date: '2025-03', globalLiquidity: 175.53, shadowMonetaryBase: 106.05, collateralMultiplier: 1.66, isRevised: true },
    { date: '2025-04', globalLiquidity: 179.14, shadowMonetaryBase: 108.57, collateralMultiplier: 1.65, isRevised: true },
    
    // 日度数据（可能修正）
    { date: '2025-04-28', rawDate: '2025-04-25', globalLiquidity: 179.14, shadowMonetaryBase: 108.57, collateralMultiplier: 1.64, isRevised: false },
    { date: '2025-05-05', rawDate: '2025-05-02', globalLiquidity: 178.62, shadowMonetaryBase: 108.31, collateralMultiplier: 1.65, isRevised: false },
    { date: '2025-05-12', rawDate: '2025-05-09', globalLiquidity: 177.91, shadowMonetaryBase: 107.75, collateralMultiplier: 1.65, isRevised: false },
  ];

  /**
   * 获取所有流动性数据
   */
  getAllLiquidityData(): HowellLiquidityResponse {
    try {
      return {
        success: true,
        data: this.liquidityData,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 获取修正后的月度数据
   */
  getRevisedMonthlyData(): HowellLiquidityResponse {
    try {
      const revisedData = this.liquidityData.filter(item => item.isRevised);
      return {
        success: true,
        data: revisedData,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 获取未修正的日度数据
   */
  getUnrevisedDailyData(): HowellLiquidityResponse {
    try {
      const unrevisedData = this.liquidityData.filter(item => !item.isRevised);
      return {
        success: true,
        data: unrevisedData,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 获取最新的流动性数据
   * @param count 返回的数据点数量
   */
  getLatestData(count: number = 10): HowellLiquidityResponse {
    try {
      // 按日期排序，最新的在前
      const sortedData = [...this.liquidityData].sort((a, b) => {
        const dateA = this.parseDate(a.date);
        const dateB = this.parseDate(b.date);
        return dateB.getTime() - dateA.getTime();
      });

      const latestData = sortedData.slice(0, count);
      
      return {
        success: true,
        data: latestData,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 解析日期字符串为Date对象
   * @param dateStr 日期字符串，格式为 YYYY-MM-DD 或 YYYY年MM月
   */
  private parseDate(dateStr: string): Date {
    if (dateStr.includes('-')) {
      // 处理 YYYY-MM-DD 格式
      return new Date(dateStr);
    } else {
      // 处理 YYYY年MM月 格式
      const match = dateStr.match(/(\d{4})年(\d{1,2})月/);
      if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]) - 1; // JavaScript月份从0开始
        return new Date(year, month, 1);
      }
      throw new Error(`Invalid date format: ${dateStr}`);
    }
  }
}
