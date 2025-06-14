import { Controller, Post, Get, Query, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { BinanceVolumeBacktestService } from '../services/binance-volume-backtest.service';
import { VolumeBacktestParamsDto, VolumeBacktestQueryDto, VolumeBacktestResponse } from '../dto/volume-backtest-params.dto';

@Controller('/v1/binance/volume-backtest')
export class BinanceVolumeBacktestController {
  private readonly logger = new Logger(BinanceVolumeBacktestController.name);

  constructor(
    private readonly volumeBacktestService: BinanceVolumeBacktestService,
  ) {}

  /**
   * 执行成交量排行榜回测
   * POST /api/binance/volume-backtest
   */
  @Post()
  async executeBacktest(@Body() params: VolumeBacktestParamsDto): Promise<VolumeBacktestResponse> {
    try {
      this.logger.log(`收到回测请求: ${JSON.stringify(params)}`);
      
      // 验证时间范围
      const startTime = new Date(params.startTime);
      const endTime = new Date(params.endTime);
      const timeDiff = endTime.getTime() - startTime.getTime();
      const maxDuration = 7 * 24 * 60 * 60 * 1000; // 最大7天

      if (timeDiff <= 0) {
        throw new HttpException('结束时间必须大于开始时间', HttpStatus.BAD_REQUEST);
      }

      if (timeDiff > maxDuration) {
        throw new HttpException('回测时间范围不能超过7天', HttpStatus.BAD_REQUEST);
      }

      const result = await this.volumeBacktestService.executeVolumeBacktest(params);
      return result;
    } catch (error) {
      this.logger.error('执行回测失败:', error);
      throw new HttpException(
        error.message || '回测执行失败',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 查询历史回测数据
   * GET /api/binance/volume-backtest
   */
  @Get()
  async getBacktestData(@Query() query: VolumeBacktestQueryDto) {
    try {
      let startTime: Date | undefined;
      let endTime: Date | undefined;

      if (query.date) {
        // 查询特定日期的数据
        startTime = new Date(query.date);
        endTime = new Date(startTime.getTime() + 24 * 60 * 60 * 1000);
      }

      if (query.hour !== undefined) {
        // 查询特定小时的数据
        if (!startTime) {
          throw new HttpException('查询特定小时需要提供日期参数', HttpStatus.BAD_REQUEST);
        }
        startTime.setHours(query.hour, 0, 0, 0);
        endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      }

      const results = await this.volumeBacktestService.getBacktestResults(
        startTime,
        endTime,
        query.symbol,
      );

      return {
        success: true,
        data: results.map(result => ({
          timestamp: result.timestamp.toISOString(),
          hour: result.hour,
          rankings: query.limit ? result.rankings.slice(0, query.limit) : result.rankings,
          marketStats: {
            totalVolume: result.totalMarketVolume,
            totalQuoteVolume: result.totalMarketQuoteVolume,
            activePairs: result.activePairs,
          },
          calculationTime: result.calculationDuration,
        })),
        meta: {
          count: results.length,
          symbol: query.symbol,
          dateRange: {
            start: startTime?.toISOString(),
            end: endTime?.toISOString(),
          },
        },
      };
    } catch (error) {
      this.logger.error('查询回测数据失败:', error);
      throw new HttpException(
        error.message || '查询失败',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 获取回测任务状态
   * GET /api/binance/volume-backtest/status
   */
  @Get('status')
  async getBacktestStatus() {
    // TODO: 实现异步任务状态查询
    return {
      success: true,
      message: '回测功能当前为同步执行模式',
    };
  }

  /**
   * 测试币安API连通性
   * GET /api/binance/volume-backtest/test-connection
   */
  @Get('test-connection')
  async testBinanceConnection() {
    try {
      this.logger.log('测试Binance API连通性...');
      
      const result = await this.volumeBacktestService.testBinanceApi();
      
      return {
        success: true,
        message: 'Binance API连通测试成功',
        data: result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Binance API连通测试失败:', error);
      throw new HttpException(
        {
          success: false,
          message: 'Binance API连通测试失败',
          error: error.message || '未知错误',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * 获取支持的交易对列表
   * GET /api/binance/volume-backtest/symbols
   */
  @Get('symbols')
  async getSupportedSymbols(@Query('quoteAsset') quoteAsset: string = 'USDT') {
    try {
      // 这里可以调用币安API获取最新的交易对列表
      // 为了演示，返回一些常见的交易对
      const commonSymbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT',
        'SOLUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'SHIBUSDT',
        'MATICUSDT', 'LTCUSDT', 'TRXUSDT', 'LINKUSDT', 'ATOMUSDT',
        'ETCUSDT', 'XLMUSDT', 'BCHUSDT', 'FILUSDT', 'VETUSDT',
      ];

      return {
        success: true,
        data: {
          quoteAsset,
          symbols: commonSymbols,
          count: commonSymbols.length,
        },
      };
    } catch (error) {
      this.logger.error('获取交易对列表失败:', error);
      throw new HttpException('获取交易对列表失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * 测试期货API连通性
   * GET /v1/binance/volume-backtest/test-futures-api
   */
  @Get('test-futures-api')
  async testFuturesApi() {
    try {
      this.logger.log('测试期货API连通性请求');
      const result = await this.volumeBacktestService.testFuturesApi();
      return result;
    } catch (error) {
      this.logger.error('期货API测试失败:', error);
      throw new HttpException(
        error.message || '期货API测试失败',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
