import { Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Model, Connection, createConnection } from "mongoose";
import { ConfigService } from "../config";
import {
  Btcdom2PositionHistory,
  Btcdom2PositionHistorySchema
} from "../models/btcdom2-position-history.model";

@Injectable()
export class Btcdom2PositionHistoryService {
  private readonly logger = new Logger(Btcdom2PositionHistoryService.name);
  private positionHistoryModel: Model<any>;
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
        this.logger.log(`已连接到btcdom2实盘持仓历史数据库: ${prodDbName}`);
      });

      this.prodConnection.on('error', (error) => {
        this.logger.error('btcdom2实盘持仓历史数据库连接错误:', error);
      });

      // 创建模型
      this.positionHistoryModel = this.prodConnection.model(
        'Btcdom2PositionHistory',
        Btcdom2PositionHistorySchema,
        'btcdom2_position_history' // 指定集合名称
      );

      this.logger.log('btcdom2实盘持仓历史数据库模型已初始化');
    } catch (error) {
      this.logger.error('初始化btcdom2实盘持仓历史数据库连接失败:', error);
      throw error;
    }
  }

  /**
   * 确保数据库连接已建立
   */
  private async ensureConnection(): Promise<void> {
    if (!this.positionHistoryModel) {
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
   * 根据市值数据时间戳获取持仓历史数据
   * @param marketDataTimestamp 市值数据时间戳
   * @returns 持仓历史数据
   */
  async getPositionByMarketDataTimestamp(
    marketDataTimestamp: Date
  ): Promise<Btcdom2PositionHistory | null> {
    try {
      // 确保数据库连接已建立
      await this.ensureConnection();

      this.logger.log(`查询btcdom2持仓历史，时间戳: ${marketDataTimestamp.toISOString()}`);

      const result = await this.positionHistoryModel
        .findOne({ market_data_timestamp: marketDataTimestamp })
        .sort({ timestamp: -1 }) // 如果有多条记录，取最新的
        .exec();

      if (result) {
        this.logger.log(`找到btcdom2持仓历史数据, execution_id: ${result.execution_id}`);
      } else {
        this.logger.log(`未找到对应时间的btcdom2持仓历史数据`);
      }

      return result;
    } catch (error) {
      this.logger.error('获取btcdom2持仓历史数据失败:', error);
      throw new Error(`获取btcdom2持仓历史数据失败: ${error.message}`);
    }
  }

  /**
   * 获取持仓历史数据 - 支持时间范围查询
   * @param startDate 开始日期 (可选)
   * @param endDate 结束日期 (可选)
   * @param sortBy 排序字段 (默认: market_data_timestamp)
   * @param sortOrder 排序方向 (默认: desc)
   * @param limit 限制返回数量 (可选)
   * @returns 持仓历史数据数组
   */
  async getPositionHistory(
    startDate?: Date,
    endDate?: Date,
    sortBy: string = 'market_data_timestamp',
    sortOrder: 'asc' | 'desc' = 'desc',
    limit?: number
  ): Promise<Btcdom2PositionHistory[]> {
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

      this.logger.log(`查询btcdom2持仓历史数据，条件: ${JSON.stringify(query)}`);

      // 构建查询
      const defaultSortBy = sortBy || 'market_data_timestamp';
      let queryBuilder = this.positionHistoryModel
        .find(query)
        .sort({ [defaultSortBy]: sortOrder === 'desc' ? -1 : 1 });

      // 如果指定了限制数量
      if (limit && limit > 0) {
        queryBuilder = queryBuilder.limit(limit);
      }

      const results = await queryBuilder.exec();

      this.logger.log(`找到 ${results.length} 条btcdom2持仓历史数据`);

      return results;
    } catch (error) {
      this.logger.error('获取btcdom2持仓历史数据失败:', error);
      throw new Error(`获取btcdom2持仓历史数据失败: ${error.message}`);
    }
  }
}