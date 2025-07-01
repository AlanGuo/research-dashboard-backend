import { Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, createConnection, Schema } from "mongoose";
import { ConfigService } from "../config";
import {
  Btcdom2Performance,
  Btcdom2PerformanceDocument,
  Btcdom2PerformanceSchema
} from "../models/btcdom2-performance.model";

@Injectable()
export class Btcdom2PerformanceService {
  private readonly logger = new Logger(Btcdom2PerformanceService.name);
  private btcdom2PerformanceModel: Model<any>;
  private prodConnection: Connection;

  constructor(
    @InjectConnection() private connection: Connection,
    private configService: ConfigService,
  ) {
    this.initializeProdConnection();
  }

  /**
   * 初始化生产数据库连接
   */
  private async initializeProdConnection() {
    try {
      // 从配置文件获取btcdom2实盘数据库配置
      const btcdom2DbConfig = this.configService.get('btcdom2_database') as {
        connection_url: string;
        db_name: string;
      };
      const prodDbUrl = btcdom2DbConfig.connection_url;
      const prodDbName = btcdom2DbConfig.db_name;

      this.prodConnection = createConnection(`${prodDbUrl}/${prodDbName}`);

      this.prodConnection.on('connected', () => {
        this.logger.log(`已连接到btcdom2实盘数据库: ${prodDbName}`);
      });

      this.prodConnection.on('error', (error) => {
        this.logger.error('btcdom2实盘数据库连接错误:', error);
      });

      // 创建模型
      this.btcdom2PerformanceModel = this.prodConnection.model(
        'Btcdom2Performance',
        Btcdom2PerformanceSchema,
        'btcdom2_performance' // 指定集合名称
      );

      this.logger.log('btcdom2实盘数据库模型已初始化');
    } catch (error) {
      this.logger.error('初始化btcdom2实盘数据库连接失败:', error);
      throw error;
    }
  }

  /**
   * 确保数据库连接已建立
   */
  private async ensureConnection(): Promise<void> {
    if (!this.btcdom2PerformanceModel) {
      await this.initializeProdConnection();
    }

    // 等待连接建立
    if (this.prodConnection.readyState !== 1) {
      await new Promise((resolve, reject) => {
        this.prodConnection.once('connected', resolve);
        this.prodConnection.once('error', reject);
        setTimeout(() => reject(new Error('数据库连接超时')), 10000);
      });
    }
  }

  /**
   * 获取所有btcdom2策略表现数据
   * @param startDate 开始日期 (可选)
   * @param endDate 结束日期 (可选)
   * @param sortBy 排序字段 (默认: market_data_timestamp)
   * @param sortOrder 排序方向 (默认: desc)
   * @param limit 限制返回数量 (可选)
   * @returns btcdom2策略表现数据数组
   */
  async getAllPerformanceData(
    startDate?: Date,
    endDate?: Date,
    sortBy: string = 'market_data_timestamp',
    sortOrder: 'asc' | 'desc' = 'desc',
    limit?: number
  ): Promise<Btcdom2Performance[]> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      // 构建查询条件
      const query: any = {};

      if (startDate || endDate) {
        query.market_data_timestamp = {};
        if (startDate) {
          query.market_data_timestamp.$gte = startDate;
        }
        if (endDate) {
          query.market_data_timestamp.$lte = endDate;
        }
      }

      this.logger.log(`查询btcdom2表现数据，条件: ${JSON.stringify(query)}`);
      this.logger.log(`startDate类型: ${typeof startDate}, 值: ${startDate}`);
      this.logger.log(`endDate类型: ${typeof endDate}, 值: ${endDate}`);

      // 先查询一条数据看看所有字段
      const sampleData = await this.btcdom2PerformanceModel.findOne().exec();
      if (sampleData) {
        this.logger.log(`样本数据所有字段: ${JSON.stringify(Object.keys(sampleData.toObject()))}`);
        this.logger.log(`样本数据market_data_timestamp类型: ${typeof sampleData.market_data_timestamp}, 值: ${sampleData.market_data_timestamp}`);
      }

      // 构建查询
      const defaultSortBy = sortBy || 'market_data_timestamp';
      let queryBuilder = this.btcdom2PerformanceModel
        .find(query)
        .sort({ [defaultSortBy]: sortOrder === 'desc' ? -1 : 1 });

      // 如果指定了限制数量
      if (limit && limit > 0) {
        queryBuilder = queryBuilder.limit(limit);
      }

      const results = await queryBuilder.exec();

      this.logger.log(`查询到 ${results.length} 条btcdom2表现数据`);
      return results;
    } catch (error) {
      this.logger.error('获取btcdom2表现数据失败:', error);
      throw new Error(`获取btcdom2表现数据失败: ${error.message}`);
    }
  }

  /**
   * 根据市场数据时间戳范围获取表现数据
   * @param startTimestamp 开始时间戳
   * @param endTimestamp 结束时间戳
   * @returns btcdom2策略表现数据数组
   */
  async getPerformanceByMarketDataTimestamp(
    startTimestamp: Date,
    endTimestamp: Date
  ): Promise<Btcdom2Performance[]> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      const query = {
        market_data_timestamp: {
          $gte: startTimestamp,
          $lte: endTimestamp
        }
      };

      this.logger.log(`按市场数据时间戳查询: ${startTimestamp.toISOString()} 到 ${endTimestamp.toISOString()}`);

      const results = await this.btcdom2PerformanceModel
        .find(query)
        .sort({ market_data_timestamp: 1 })
        .exec();

      this.logger.log(`查询到 ${results.length} 条数据`);
      return results;
    } catch (error) {
      this.logger.error('按市场数据时间戳查询失败:', error);
      throw new Error(`按市场数据时间戳查询失败: ${error.message}`);
    }
  }

  /**
   * 获取最新的表现数据
   * @param count 获取最新的几条数据 (默认: 1)
   * @returns 最新的btcdom2策略表现数据
   */
  async getLatestPerformanceData(count: number = 1): Promise<Btcdom2Performance[]> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      const results = await this.btcdom2PerformanceModel
        .find()
        .sort({ market_data_timestamp: -1 })
        .limit(count)
        .exec();

      this.logger.log(`获取到最新 ${results.length} 条表现数据`);
      return results;
    } catch (error) {
      this.logger.error('获取最新表现数据失败:', error);
      throw new Error(`获取最新表现数据失败: ${error.message}`);
    }
  }

  /**
   * 获取表现数据统计信息
   * @returns 统计信息
   */
  async getPerformanceStatistics(): Promise<{
    totalRecords: number;
    dateRange: {
      earliest: Date | null;
      latest: Date | null;
    };
    performanceSummary: {
      totalPnl: number;
      totalReturnRate: number;
      totalTrades: number;
      totalFees: number;
      totalFundingFees: number;
    };
  }> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      // 获取总记录数
      const totalRecords = await this.btcdom2PerformanceModel.countDocuments();

      // 获取日期范围
      const dateRangeResult = await this.btcdom2PerformanceModel.aggregate([
        {
          $group: {
            _id: null,
            earliest: { $min: "$market_data_timestamp" },
            latest: { $max: "$market_data_timestamp" }
          }
        }
      ]);

      // 获取最新的表现汇总
      const latestRecord = await this.btcdom2PerformanceModel
        .findOne()
        .sort({ market_data_timestamp: -1 })
        .exec();

      const dateRange = dateRangeResult.length > 0 ? dateRangeResult[0] : { earliest: null, latest: null };
      
      const performanceSummary = latestRecord ? {
        totalPnl: latestRecord.total_pnl,
        totalReturnRate: latestRecord.total_return_rate,
        totalTrades: latestRecord.total_trades,
        totalFees: latestRecord.total_fees_usdt,
        totalFundingFees: latestRecord.total_funding_fee_usdt
      } : {
        totalPnl: 0,
        totalReturnRate: 0,
        totalTrades: 0,
        totalFees: 0,
        totalFundingFees: 0
      };

      return {
        totalRecords,
        dateRange,
        performanceSummary
      };
    } catch (error) {
      this.logger.error('获取表现统计信息失败:', error);
      throw new Error(`获取表现统计信息失败: ${error.message}`);
    }
  }

  /**
   * 根据执行ID获取表现数据
   * @param executionId 执行ID
   * @returns btcdom2策略表现数据
   */
  async getPerformanceByExecutionId(executionId: string): Promise<Btcdom2Performance | null> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      const result = await this.btcdom2PerformanceModel
        .findOne({ execution_id: executionId })
        .exec();

      return result;
    } catch (error) {
      this.logger.error(`根据执行ID ${executionId} 查询失败:`, error);
      throw new Error(`根据执行ID查询失败: ${error.message}`);
    }
  }
}
