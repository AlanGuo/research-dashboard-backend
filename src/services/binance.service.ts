import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ConfigService } from '../config/config.service';

interface KlineData {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  count: number;
  takerBuyVolume: string;
  takerBuyQuoteVolume: string;
}

@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * 通用的Binance API调用方法
   */
  async callBinanceApi<T = any>(
    endpoint: string,
    params?: Record<string, any>,
    options?: {
      timeout?: number;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      data?: any;
    }
  ): Promise<T> {
    try {
      const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
      const httpsProxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, {
        rejectUnauthorized: false
      }) : undefined;

      const config: any = {
        method: options?.method || 'GET',
        url: `${this.configService.binanceApiUrl}${endpoint}`,
        params: params,
        data: options?.data,
        timeout: options?.timeout || 10000,
        proxy: false, // 禁用axios的代理设置
      };

      if (httpsProxyAgent) {
        config.httpsAgent = httpsProxyAgent;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      this.logger.error(`Binance API调用失败 [${endpoint}]:`, error);
      throw error;
    }
  }

  /**
   * 获取服务器时间
   */
  async getServerTime(): Promise<{ serverTime: number; localTime: string }> {
    const data = await this.callBinanceApi('/api/v3/time');
    return {
      serverTime: data.serverTime,
      localTime: new Date(data.serverTime).toISOString()
    };
  }

  /**
   * 获取交易对信息
   */
  async getExchangeInfo(): Promise<any> {
    return this.callBinanceApi('/api/v3/exchangeInfo');
  }

  /**
   * 获取24小时价格变动统计
   */
  async get24hrTicker(symbol?: string): Promise<any> {
    const params = symbol ? { symbol } : {};
    return this.callBinanceApi('/api/v3/ticker/24hr', params);
  }

  /**
   * 获取K线数据
   */
  async getKlines(params: {
    symbol: string;
    interval: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<KlineData[]> {
    const data = await this.callBinanceApi('/api/v3/klines', params);
    return data.map(kline => ({
      openTime: kline[0],
      open: kline[1],
      high: kline[2],
      low: kline[3],
      close: kline[4],
      volume: kline[5],
      closeTime: kline[6],
      quoteVolume: kline[7],
      count: kline[8],
      takerBuyVolume: kline[9],
      takerBuyQuoteVolume: kline[10],
    }));
  }

  /**
   * 测试API连通性
   */
  async testConnectivity(): Promise<{ success: boolean; serverTime: string; message: string }> {
    try {
      this.logger.log('开始测试Binance API连通性...');

      const timeData = await this.getServerTime();
      this.logger.log(`Binance服务器时间: ${timeData.localTime}`);
      
      return {
        success: true,
        serverTime: timeData.localTime,
        message: 'Binance API连接正常'
      };
    } catch (error) {
      this.logger.error('Binance API连通性测试失败:', error);
      throw error;
    }
  }

  /**
   * 延迟函数 - 用于API限流
   */
  delay(ms?: number): Promise<void> {
    const delayTime = ms || this.configService.binanceRequestDelay;
    return new Promise(resolve => setTimeout(resolve, delayTime));
  }
}
