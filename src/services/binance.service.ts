import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ConfigService } from "../config/config.service";

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
   * 通用的Binance API调用方法（带重试机制）
   */
  async callBinanceApi<T = any>(
    endpoint: string,
    params?: Record<string, any>,
    options?: {
      timeout?: number;
      method?: "GET" | "POST" | "PUT" | "DELETE";
      data?: any;
      maxRetries?: number;
      context?: string; // 添加上下文信息
      useFuturesApi?: boolean; // 是否使用期货API
    },
  ): Promise<T> {
    const maxRetries = options?.maxRetries || 3;
    const context = options?.context || "";
    const useFuturesApi = options?.useFuturesApi || false;

    // 根据API类型选择基础URL
    const baseUrl = useFuturesApi
      ? this.configService.binanceFuturesApiUrl
      : this.configService.binanceApiUrl;

    // 创建请求标识符用于日志追踪
    const apiType = useFuturesApi ? "[期货API]" : "[现货API]";
    const requestId = `${apiType}${endpoint}${params?.symbol ? `[${params.symbol}]` : ""}${context ? `(${context})` : ""}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const proxyUrl =
          process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
        const httpsProxyAgent = proxyUrl
          ? new HttpsProxyAgent(proxyUrl, {
              rejectUnauthorized: false,
            })
          : undefined;

        const config: any = {
          method: options?.method || "GET",
          url: `${baseUrl}${endpoint}`,
          params: params,
          data: options?.data,
          timeout: options?.timeout || 10000,
          proxy: false, // 禁用axios的代理设置
        };

        if (httpsProxyAgent) {
          config.httpsAgent = httpsProxyAgent;
        }

        const response = await axios(config);

        // 如果之前有重试，记录成功信息
        if (attempt > 1) {
          this.logger.log(
            `✅ API重试成功 ${requestId} - 第${attempt}次尝试成功`,
          );
        }

        return response.data;
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const errorMsg =
          error.response?.data?.msg || error.message || "未知错误";
        const statusCode = error.response?.status || "N/A";

        if (isLastAttempt) {
          this.logger.error(
            `❌ API调用最终失败 ${requestId} - 已重试${maxRetries}次`,
          );
          this.logger.error(`   错误信息: ${errorMsg} (状态码: ${statusCode})`);
          this.logger.error(`   请求URL: ${baseUrl}${endpoint}`);
          this.logger.error(`   请求参数: ${JSON.stringify(params)}`);
          throw error;
        } else {
          this.logger.warn(
            `⚠️ API调用失败 ${requestId} - 第${attempt}/${maxRetries}次重试`,
          );
          this.logger.warn(`   错误信息: ${errorMsg} (状态码: ${statusCode})`);

          // 根据错误类型决定延迟时间
          let delayMs = 1000 * attempt; // 基础延迟：1s, 2s, 3s...

          // 如果是速率限制错误，使用更长的延迟
          if (
            error.response?.status === 429 ||
            error.message.includes("rate limit")
          ) {
            delayMs = 5000 * attempt; // 5s, 10s, 15s...
            this.logger.warn(
              `🚦 检测到速率限制 ${requestId}，延长等待时间至 ${delayMs}ms`,
            );
          }

          await this.delay(delayMs);
        }
      }
    }

    // 这行代码实际上不会执行，但TypeScript需要
    throw new Error(
      `Unexpected error in callBinanceApi after ${maxRetries} attempts`,
    );
  }

  /**
   * 获取服务器时间
   */
  async getServerTime(): Promise<{ serverTime: number; localTime: string }> {
    const data = await this.callBinanceApi("/api/v3/time");
    return {
      serverTime: data.serverTime,
      localTime: new Date(data.serverTime).toISOString(),
    };
  }

  /**
   * 获取交易对信息
   */
  async getExchangeInfo(): Promise<any> {
    return this.callBinanceApi("/api/v3/exchangeInfo");
  }

  /**
   * 获取24小时价格变动统计
   */
  async get24hrTicker(symbol?: string): Promise<any> {
    const params = symbol ? { symbol } : {};
    return this.callBinanceApi("/api/v3/ticker/24hr", params);
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
    const startTimeStr = params.startTime
      ? new Date(params.startTime).toISOString().slice(0, 16)
      : "";
    const endTimeStr = params.endTime
      ? new Date(params.endTime).toISOString().slice(0, 16)
      : "";
    const context = `${params.symbol} ${startTimeStr}-${endTimeStr}`;

    const data = await this.callBinanceApi("/api/v3/klines", params, {
      context,
    });
    return data.map((kline) => ({
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
   * 获取期货K线数据
   */
  async getFuturesKlines(params: {
    symbol: string;
    interval: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<KlineData[]> {
    const startTimeStr = params.startTime
      ? new Date(params.startTime).toISOString().slice(0, 16)
      : "";
    const endTimeStr = params.endTime
      ? new Date(params.endTime).toISOString().slice(0, 16)
      : "";
    const context = `期货${params.symbol} ${startTimeStr}-${endTimeStr}`;

    const data = await this.callBinanceApi("/fapi/v1/klines", params, {
      context,
      useFuturesApi: true,
    });
    return data.map((kline) => ({
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
   * 获取期货交易所信息
   */
  async getFuturesExchangeInfo(): Promise<any> {
    return this.callBinanceApi(
      "/fapi/v1/exchangeInfo",
      {},
      {
        context: "期货交易所信息",
        useFuturesApi: true, // 使用期货API
      },
    );
  }

  /**
   * 获取资金费率历史
   */
  async getFundingRateHistory(params: {
    symbol: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<any[]> {
    const context = `资金费率历史${params.symbol}`;

    try {
      const result = await this.callBinanceApi("/fapi/v1/fundingRate", params, {
        context,
        useFuturesApi: true,
      });

      // 确保返回的是数组
      if (!Array.isArray(result)) {
        this.logger.warn(`⚠️ ${params.symbol} 资金费率API返回非数组数据:`, result);
        return [];
      }

      return result;
    } catch (error) {
      this.logger.error(`❌ 获取资金费率历史失败: ${params.symbol}`, error);
      return [];
    }
  }

  /**
   * 检查交易对是否有对应的永续合约
   */
  async checkFuturesAvailability(
    symbols: string[],
  ): Promise<{ [symbol: string]: boolean }> {
    this.logger.log(
      `🔍 开始检查 ${symbols.length} 个交易对的期货合约可用性...`,
    );

    try {
      this.logger.debug("正在获取期货交易所信息...");
      const futuresInfo = await this.getFuturesExchangeInfo();

      if (!futuresInfo || !futuresInfo.symbols) {
        this.logger.error("期货交易所信息返回格式异常:", futuresInfo);
        throw new Error("期货交易所信息格式异常");
      }

      this.logger.debug(
        `📊 获取到 ${futuresInfo.symbols.length} 个期货交易对信息`,
      );

      // 过滤出永续合约
      const perpetualContracts = futuresInfo.symbols.filter((s: any) => {
        return s.status === "TRADING" && s.contractType === "PERPETUAL";
      });

      this.logger.debug(`🔍 其中永续合约数量: ${perpetualContracts.length}`);

      const futuresSymbols = new Set<string>(
        perpetualContracts.map((s: any) => s.symbol as string),
      );

      const result: { [symbol: string]: boolean } = {};
      const withFutures: string[] = [];
      const withoutFutures: string[] = [];
      const mappedFutures: string[] = [];

      for (const symbol of symbols) {
        // 检查是否有对应的永续合约
        const futuresSymbol = this.mapSpotToFutures(symbol, futuresSymbols);
        const hasFutures = futuresSymbol !== null;
        result[symbol] = hasFutures;

        if (hasFutures) {
          withFutures.push(symbol);
          if (futuresSymbol !== symbol) {
            mappedFutures.push(`${symbol} -> ${futuresSymbol}`);
          }
        } else {
          withoutFutures.push(symbol);
        }
      }

      this.logger.log(`✅ 期货合约检查完成:`);
      this.logger.log(
        `   有永续合约: ${withFutures.length}/${symbols.length} (${((withFutures.length / symbols.length) * 100).toFixed(1)}%)`,
      );
      this.logger.log(
        `   无永续合约: ${withoutFutures.length}/${symbols.length}`,
      );

      if (mappedFutures.length > 0) {
        this.logger.log(`   映射的合约: ${mappedFutures.length} 个`);
      }

      if (withFutures.length > 0) {
        const sampleWith = withFutures.slice(0, 5);
        this.logger.debug(`   有期货合约示例: ${sampleWith.join(", ")}`);
      }

      if (withoutFutures.length > 0) {
        const sampleWithout = withoutFutures.slice(0, 5);
        this.logger.debug(`   无期货合约示例: ${sampleWithout.join(", ")}`);
      }

      return result;
    } catch (error) {
      this.logger.error("获取期货交易所信息失败:", error);
      this.logger.error("错误详情:", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });

      // 如果获取失败，默认认为都没有期货合约
      this.logger.warn("⚠️ 由于期货API调用失败，将所有交易对标记为无期货合约");
      const result: { [symbol: string]: boolean } = {};
      symbols.forEach((symbol) => (result[symbol] = false));
      return result;
    }
  }

  /**
   * 测试API连通性
   */
  async testConnectivity(): Promise<{
    success: boolean;
    serverTime: string;
    message: string;
  }> {
    try {
      this.logger.log("开始测试Binance API连通性...");

      const timeData = await this.getServerTime();
      this.logger.log(`Binance服务器时间: ${timeData.localTime}`);

      return {
        success: true,
        serverTime: timeData.localTime,
        message: "Binance API连接正常",
      };
    } catch (error) {
      this.logger.error("Binance API连通性测试失败:", error);
      throw error;
    }
  }

  /**
   * 测试期货API连通性
   */
  async testFuturesConnectivity(): Promise<{
    success: boolean;
    contractCount: number;
    sampleContracts: string[];
    message: string;
  }> {
    try {
      this.logger.log("开始测试Binance期货API连通性...");

      const futuresInfo = await this.getFuturesExchangeInfo();

      if (!futuresInfo || !futuresInfo.symbols) {
        throw new Error("期货API返回数据格式异常");
      }

      const perpetualContracts = futuresInfo.symbols
        .filter(
          (s: any) => s.status === "TRADING" && s.contractType === "PERPETUAL",
        )
        .map((s: any) => s.symbol);

      const sampleContracts = perpetualContracts.slice(0, 10);

      this.logger.log(
        `✅ 期货API连接正常，永续合约数量: ${perpetualContracts.length}`,
      );
      this.logger.log(`示例合约: ${sampleContracts.join(", ")}`);

      return {
        success: true,
        contractCount: perpetualContracts.length,
        sampleContracts,
        message: "期货API连接正常",
      };
    } catch (error) {
      this.logger.error("期货API连通性测试失败:", error);
      return {
        success: false,
        contractCount: 0,
        sampleContracts: [],
        message: `期货API连接失败: ${error.message}`,
      };
    }
  }

  /**
   * 将现货交易对映射到对应的期货交易对
   * 处理特殊情况，如 PEPEUSDT -> 1000PEPEUSDT
   */
  private mapSpotToFutures(spotSymbol: string, futuresSymbols: Set<string>): string | null {
    // 1. 直接匹配（大多数情况）
    if (futuresSymbols.has(spotSymbol)) {
      return spotSymbol;
    }

    // 2. 特殊映射规则
    const specialMappings: { [spot: string]: string } = {
      'PEPEUSDT': '1000PEPEUSDT',
      'SHIBUSDT': '1000SHIBUSDT',
      'LUNCUSDT': '1000LUNCUSDT',
      'XECUSDT': '1000XECUSDT',
      'FLOKIUSDT': '1000FLOKIUSDT',
      'RATSUSDT': '1000RATSUSDT',
      'BONKUSDT': '1000BONKUSDT',
      // 可以根据需要添加更多映射
    };

    const mappedSymbol = specialMappings[spotSymbol];
    if (mappedSymbol && futuresSymbols.has(mappedSymbol)) {
      return mappedSymbol;
    }

    // 3. 动态映射：尝试添加1000前缀
    if (spotSymbol.endsWith('USDT')) {
      const baseAsset = spotSymbol.replace('USDT', '');
      const thousandPrefix = `1000${baseAsset}USDT`;
      if (futuresSymbols.has(thousandPrefix)) {
        return thousandPrefix;
      }
    }

    // 4. 没有找到对应的期货合约
    return null;
  }

  /**
   * 将现货交易对映射到对应的期货交易对（公开方法）
   */
  async mapToFuturesSymbol(spotSymbol: string): Promise<string | null> {
    try {
      // 获取期货交易所信息
      const futuresInfo = await this.getFuturesExchangeInfo();
      const perpetualContracts = futuresInfo.symbols.filter((s: any) => {
        return s.status === "TRADING" && s.contractType === "PERPETUAL";
      });
      const futuresSymbols = new Set<string>(
        perpetualContracts.map((s: any) => s.symbol as string),
      );
      
      return this.mapSpotToFutures(spotSymbol, futuresSymbols);
    } catch (error) {
      this.logger.error(`映射期货交易对失败: ${spotSymbol}`, error);
      return null;
    }
  }

  /**
   * 延迟函数 - 用于API限流
   */
  delay(ms?: number): Promise<void> {
    const delayTime = ms || this.configService.binanceRequestDelay;
    return new Promise((resolve) => setTimeout(resolve, delayTime));
  }
}
