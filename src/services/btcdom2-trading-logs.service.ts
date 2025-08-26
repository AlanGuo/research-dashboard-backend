import { Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, createConnection } from "mongoose";
import { ConfigService } from "../config";
import {
  Btcdom2TradingLogs,
  Btcdom2TradingLogsSchema
} from "../models/btcdom2-trading-logs.model";

@Injectable()
export class Btcdom2TradingLogsService {
  private readonly logger = new Logger(Btcdom2TradingLogsService.name);
  private btcdom2TradingLogsModel: Model<any>;
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
        this.logger.log(`已连接到btcdom2实盘交易日志数据库: ${prodDbName}`);
      });

      this.prodConnection.on('error', (error) => {
        this.logger.error('btcdom2实盘交易日志数据库连接错误:', error);
      });

      // 创建模型
      this.btcdom2TradingLogsModel = this.prodConnection.model(
        'Btcdom2TradingLogs',
        Btcdom2TradingLogsSchema,
        'btcdom2_trading_logs' // 指定集合名称
      );

      this.logger.log('btcdom2实盘交易日志数据库模型已初始化');
    } catch (error) {
      this.logger.error('初始化btcdom2实盘交易日志数据库连接失败:', error);
      throw error;
    }
  }

  /**
   * 确保数据库连接已建立
   */
  private async ensureConnection(): Promise<void> {
    if (!this.btcdom2TradingLogsModel) {
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
   * 根据市场数据时间戳范围获取交易日志数据
   * @param startTimestamp 开始时间戳
   * @param endTimestamp 结束时间戳
   * @returns btcdom2交易日志数据数组
   */
  async getTradingLogsByMarketDataTimestamp(
    startTimestamp: Date,
    endTimestamp: Date
  ): Promise<Btcdom2TradingLogs[]> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      const query = {
        market_data_timestamp: {
          $gte: startTimestamp,
          $lte: endTimestamp
        },
        status: 'SUCCESS' // 只获取成功的交易
      };

      this.logger.log(`按市场数据时间戳查询交易日志: ${startTimestamp.toISOString()} 到 ${endTimestamp.toISOString()}`);

      const results = await this.btcdom2TradingLogsModel
        .find(query)
        .sort({ market_data_timestamp: 1, timestamp: 1 })
        .exec();

      this.logger.log(`查询到 ${results.length} 条交易日志数据`);
      return results;
    } catch (error) {
      this.logger.error('按市场数据时间戳查询交易日志失败:', error);
      throw new Error(`按市场数据时间戳查询交易日志失败: ${error.message}`);
    }
  }

  /**
   * 根据单个市场数据时间戳获取交易日志数据
   * @param marketDataTimestamp 市场数据时间戳
   * @returns btcdom2交易日志数据数组
   */
  async getTradingLogsByExactMarketDataTimestamp(
    marketDataTimestamp: Date
  ): Promise<Btcdom2TradingLogs[]> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      const query = {
        market_data_timestamp: marketDataTimestamp,
        status: 'SUCCESS' // 只获取成功的交易
      };

      this.logger.log(`按准确市场数据时间戳查询交易日志: ${marketDataTimestamp.toISOString()}`);

      const results = await this.btcdom2TradingLogsModel
        .find(query)
        .sort({ timestamp: 1 })
        .exec();

      this.logger.log(`查询到 ${results.length} 条交易日志数据`);
      return results;
    } catch (error) {
      this.logger.error('按准确市场数据时间戳查询交易日志失败:', error);
      throw new Error(`按准确市场数据时间戳查询交易日志失败: ${error.message}`);
    }
  }

  /**
   * 获取交易日志统计信息
   * @returns 统计信息
   */
  async getTradingLogsStatistics(): Promise<{
    totalRecords: number;
    successfulTrades: number;
    dateRange: {
      earliest: Date | null;
      latest: Date | null;
    };
  }> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      // 获取总记录数
      const totalRecords = await this.btcdom2TradingLogsModel.countDocuments();

      // 获取成功交易数
      const successfulTrades = await this.btcdom2TradingLogsModel.countDocuments({ status: 'SUCCESS' });

      // 获取日期范围
      const dateRangeResult = await this.btcdom2TradingLogsModel.aggregate([
        {
          $group: {
            _id: null,
            earliest: { $min: "$market_data_timestamp" },
            latest: { $max: "$market_data_timestamp" }
          }
        }
      ]);

      const dateRange = dateRangeResult.length > 0 ? dateRangeResult[0] : { earliest: null, latest: null };

      return {
        totalRecords,
        successfulTrades,
        dateRange
      };
    } catch (error) {
      this.logger.error('获取交易日志统计信息失败:', error);
      throw new Error(`获取交易日志统计信息失败: ${error.message}`);
    }
  }
}