import { Injectable } from '@nestjs/common';
import { TradingViewService } from './tradingview.service';
import { GliParamsDto } from '../dto/gli-params.dto';
import { GliDataPoint, GliResponse } from '../models/gli.model';
import { calculateROC, calculateSMA } from '../utils/technical-indicators';

@Injectable()
export class GliService {
  private readonly trillion = 1000000000000;

  constructor(private readonly tradingViewService: TradingViewService) {}

  async getGli(params: GliParamsDto): Promise<GliResponse> {
    try {
      // Fetch all required data
      const rawData = await this.fetchAllData(params);
      
      if (rawData.length === 0) {
        return {
          success: true,
          data: [],
          timestamp: new Date().toISOString(),
          params,
          message: 'No data available from data sources'
        };
      }
      
      // Process the data and calculate GLI
      const processedData = this.processGliData(rawData, params);
      
      return {
        success: true,
        data: processedData,
        timestamp: new Date().toISOString(),
        params
      };
    } catch (error) {
      console.error(`Error calculating GLI:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async fetchAllData(params: GliParamsDto): Promise<any[]> {
    const symbols = this.getRequiredSymbols(params);

    // Map the interval parameter to TradingView format
    const interval = params.interval || "1D";
    const limit = params.limit || 100;
    const from = params.from;
    
    // 如果是测试环境，可以设置一个更小的limit用于调试
    // const limit = process.env.NODE_ENV === 'development' ? 10 : (params.limit || 100);

    if (symbols.length === 0) {
      return [];
    }

    // Fetch data for all symbols in parallel
    const promises = symbols.map(symbol => 
      this.tradingViewService.getKlineData(symbol, interval, limit, from)
        .catch(error => {
          console.error(`Error fetching data for ${symbol}:`, error);
          return null; // Return null for failed requests
        })
    );

    const results = await Promise.all(promises);
    
    // Create a map of symbol to data
    const dataMap = new Map();
    for (let i = 0; i < symbols.length; i++) {
      if (results[i]) {
        dataMap.set(symbols[i], results[i]);
      }
    }

    return this.alignDataByTimestamp(dataMap, limit, from);
  }

  private getRequiredSymbols(params: GliParamsDto): string[] {
    const symbols = [];
    const exchangeRatesNeeded = new Set<string>();

    // Central Banks
    if (params.fed_active) symbols.push('USCBBS');
    if (params.rrp_active) symbols.push('RRPONTSYD');
    if (params.tga_active) symbols.push('WTREGEN');
    if (params.ecb_active) {
      symbols.push('EUCBBS');
      exchangeRatesNeeded.add('EURUSD');
    }
    if (params.pbc_active) {
      symbols.push('CNCBBS');
      exchangeRatesNeeded.add('CNYUSD');
    }
    if (params.boj_active) {
      symbols.push('JPCBBS');
      exchangeRatesNeeded.add('JPYUSD');
    }
    // Other Central Banks
    if (params.other_active) {
      symbols.push('GBCBBS');
      exchangeRatesNeeded.add('GBPUSD');
      symbols.push('CACBBS');
      exchangeRatesNeeded.add('CADUSD');
      symbols.push('AUCBBS');
      exchangeRatesNeeded.add('AUDUSD');
      symbols.push('INCBBS');
      exchangeRatesNeeded.add('INRUSD');
      symbols.push('CHCBBS');
      exchangeRatesNeeded.add('CHFUSD');
      symbols.push('RUCBBS');
      exchangeRatesNeeded.add('RUBUSD');
      symbols.push('BRCBBS');
      exchangeRatesNeeded.add('BRLUSD');
      symbols.push('KRCBBS');
      exchangeRatesNeeded.add('KRWUSD');
      symbols.push('NZCBBS');
      exchangeRatesNeeded.add('NZDUSD');
      symbols.push('SECBBS');
      exchangeRatesNeeded.add('SEKUSD');
      symbols.push('MYCBBS');
      exchangeRatesNeeded.add('MYRUSD');
    }
    
    // M2 Supply
    if (params.usa_active) symbols.push('ECONOMICS:USM2');
    if (params.europe_active) {
      symbols.push('ECONOMICS:EUM2');
      exchangeRatesNeeded.add('EURUSD');
    }
    if (params.china_active) {
      symbols.push('ECONOMICS:CNM2');
      exchangeRatesNeeded.add('CNYUSD');
    }
    if (params.japan_active) {
      symbols.push('ECONOMICS:JPM2');
      exchangeRatesNeeded.add('JPYUSD');
    }
    
    // Other M2
    if (params.other_m2_active) {
      symbols.push('ECONOMICS:GBM2');
      exchangeRatesNeeded.add('GBPUSD');
      symbols.push('ECONOMICS:CAM2');
      exchangeRatesNeeded.add('CADUSD');
      symbols.push('ECONOMICS:AUM3');
      exchangeRatesNeeded.add('AUDUSD');
      symbols.push('ECONOMICS:INM2');
      exchangeRatesNeeded.add('INRUSD');
      symbols.push('ECONOMICS:CHM2');
      exchangeRatesNeeded.add('CHFUSD');
      symbols.push('ECONOMICS:RUM2');
      exchangeRatesNeeded.add('RUBUSD');
      symbols.push('ECONOMICS:BRM2');
      exchangeRatesNeeded.add('BRLUSD');
      symbols.push('ECONOMICS:KRM2');
      exchangeRatesNeeded.add('KRWUSD');
      symbols.push('ECONOMICS:MXM2');
      exchangeRatesNeeded.add('MXNUSD');
      symbols.push('ECONOMICS:IDM2');
      exchangeRatesNeeded.add('IDRUSD');
      symbols.push('ECONOMICS:ZAM2');
      exchangeRatesNeeded.add('ZARUSD');
      symbols.push('ECONOMICS:MYM2');
      exchangeRatesNeeded.add('MYRUSD');
      symbols.push('ECONOMICS:SEM2');
      exchangeRatesNeeded.add('SEKUSD');
    }
    
    // Add needed exchange rates to the symbols list
    exchangeRatesNeeded.forEach(rate => {
      symbols.push(rate);
    });
    
    return symbols;
  }

  /**
   * 对齐数据并生成指定时间范围内的数据点
   * @param dataMap 符号到数据的映射
   * @param limit 限制数量，默认10
   * @param from 起始时间戳（可选）
   * @returns 对齐后的数据点数组
   */
  private alignDataByTimestamp(dataMap: Map<string, any>, limit: number = 10, from?: number): any[] {
    // 生成我们需要的时间范围（从新到旧）
    const timestamps: number[] = [];
    const now = new Date().getTime();
    const startTime = from || (now - (limit * 24 * 60 * 60 * 1000)); // 如果没有from，则使用当前时间减去 limit 天
    
    // 生成每天的时间戳（基于限制或者起始时间）
    const endTime = from ? (from + (limit * 24 * 60 * 60 * 1000)) : now;
    
    // 生成每天的时间戳，从新到旧排序
    for (let t = endTime; t >= startTime; t -= 24 * 60 * 60 * 1000) {
      // 将时间调整为当天的零点
      const date = new Date(t);
      date.setHours(0, 0, 0, 0);
      timestamps.push(date.getTime());
    }
    
    // 创建对齐的数据点
    const alignedData = [];
    
    // 预处理所有数据源，为每个符号将数据按时间戳排序
    const sortedCandlesMap = new Map<string, any[]>();
    dataMap.forEach((data, symbol) => {
      if (data && data.candles && data.candles.length > 0) {
        // 按时间戳排序（从新到旧）
        const sortedCandles = [...data.candles].sort((a, b) => b.timestamp - a.timestamp);
        sortedCandlesMap.set(symbol, sortedCandles);
      }
    });
    
    // 对每个时间戳创建数据点
    for (const timestamp of timestamps) {
      const dataPoint: any = { timestamp };
      dataPoint.datetime = new Date(timestamp).toISOString();
      
      // 为每个符号找到最接近的数据
      sortedCandlesMap.forEach((sortedCandles, symbol) => {
        // 找到小于等于当前时间戳的最新数据
        // 这确保了我们使用的是当前时间戳或之前的最新数据
        const latestCandle = sortedCandles.find(candle => candle.timestamp <= timestamp);
        
        if (latestCandle) {
          // 使用最新的数据
          dataPoint[symbol] = latestCandle.close;
        } else if (sortedCandles.length > 0) {
          // 如果没有找到小于等于当前时间戳的数据，但有其他数据，使用最早的数据
          // 这种情况只会发生在时间范围的开始早于所有可用数据的情况
          dataPoint[symbol] = sortedCandles[sortedCandles.length - 1].close;
        }
      });
      
      alignedData.push(dataPoint);
    }
    
    return alignedData;
  }

  // 是否开启详细的数据缺失日志
  private readonly enableDetailedLogs = false;
  
  /**
   * 获取带汇率转换的符号数据值
   * @param dataPoint 原始数据点
   * @param symbolName 符号名称
   * @param exchangeRate 汇率
   * @param missingDataSymbols 缺失数据符号集合
   * @param processed 处理后的数据点（可选）
   * @param targetField 目标字段名（可选）
   * @returns 转换后的值
   */
  private getSymbolValueWithRate(
    dataPoint: any, 
    symbolName: string, 
    exchangeRate: number, 
    missingDataSymbols: Set<string>,
    processed?: Partial<GliDataPoint>,
    targetField?: string
  ): number {
    const value = dataPoint[symbolName];
    
    // 记录缺失数据
    if (value === undefined && !missingDataSymbols.has(symbolName)) {
      missingDataSymbols.add(symbolName);
      if (this.enableDetailedLogs) {
        console.warn(`符号 ${symbolName} 数据缺失`);
      }
    }
    
    const convertedValue = (value || 0) * (exchangeRate || 1);
    
    // 如果提供了processed和targetField，保存原始数据
    if (processed && targetField) {
      processed[`raw_${targetField}`] = value || 0;
      processed[targetField] = convertedValue;
    }
    
    // 返回带汇率转换的值
    return convertedValue;
  }
  
  /**
   * 处理单个符号的数据
   * @param dataPoint 原始数据点
   * @param processed 处理后的数据点
   * @param symbolName 符号名称
   * @param targetField 目标字段名
   * @param isActive 是否激活
   * @param missingDataSymbols 缺失数据符号集合
   * @param exchangeRate 汇率（可选）
   */
  private processSymbolData(
    dataPoint: any, 
    processed: Partial<GliDataPoint>, 
    symbolName: string, 
    targetField: string, 
    isActive: boolean, 
    missingDataSymbols: Set<string>,
    exchangeRate?: number
  ): void {
    if (!isActive) return;
    
    const value = dataPoint[symbolName];
    
    // 记录缺失数据
    if (value === undefined && !missingDataSymbols.has(symbolName)) {
      missingDataSymbols.add(symbolName);
      if (this.enableDetailedLogs) {
        console.warn(`符号 ${symbolName} 数据缺失`);
      }
    }
    
    // 设置值，如果需要汇率转换则应用汇率
    if (exchangeRate !== undefined) {
      // 保存原始数据（未经汇率转换）
      processed[`raw_${targetField}`] = value || 0;
      // 设置汇率转换后的值
      processed[targetField] = (value || 0) * (exchangeRate || 1);
    } else {
      processed[targetField] = value || 0;
    }
  }

  private processGliData(rawData: any[], params: GliParamsDto): GliDataPoint[] {
    const processedData: GliDataPoint[] = [];
    
    // 记录数据缺失的符号，避免重复记录
    const missingDataSymbols = new Set<string>();
    
    // Process each data point
    for (const dataPoint of rawData) {
      // 创建基础数据点，只包含必要的时间戳和日期时间
      const processed: Partial<GliDataPoint> = {
        timestamp: dataPoint.timestamp,
        datetime: dataPoint.datetime,
      };
      
      // 需要的汇率集合
      const neededRates = new Set<string>();
      
      // 只有在需要时才添加汇率
      if (params.ecb_active) neededRates.add('eurusd');
      if (params.pbc_active) neededRates.add('cnyusd');
      if (params.boj_active) neededRates.add('jpyusd');
      if (params.other_active) {
        neededRates.add('gbpusd');
        neededRates.add('cadusd');
        neededRates.add('audusd');
        neededRates.add('inrusd');
        neededRates.add('chfusd');
        neededRates.add('rubusd');
        neededRates.add('brlusd');
        neededRates.add('krwusd');
        neededRates.add('sekusd');
        neededRates.add('myrusd');
      }
      if (params.europe_active) neededRates.add('eurusd');
      if (params.china_active) neededRates.add('cnyusd');
      if (params.japan_active) neededRates.add('jpyusd');
      if (params.other_m2_active) {
        neededRates.add('gbpusd');
        neededRates.add('cadusd');
        neededRates.add('audusd');
        neededRates.add('inrusd');
        neededRates.add('chfusd');
        neededRates.add('rubusd');
        neededRates.add('brlusd');
        neededRates.add('krwusd');
        neededRates.add('mxnusd');
        neededRates.add('idrusd');
        neededRates.add('zarusd');
        neededRates.add('myrusd');
        neededRates.add('sekusd');
      }
      
      // 添加需要的汇率
      const rates: Record<string, number> = {};
      neededRates.forEach(rate => {
        const upperRate = rate.toUpperCase();
        if (!dataPoint[upperRate] && !missingDataSymbols.has(upperRate)) {
          missingDataSymbols.add(upperRate);
          console.warn(`汇率 ${upperRate} 数据缺失，使用默认值1`);
        }
        rates[rate] = dataPoint[upperRate] || 1;
      });
      
      // 提取并添加需要的汇率
      Object.entries(rates).forEach(([key, value]) => {
        processed[key] = value;
      });
      
      // 提取激活的央行数据
      this.processSymbolData(dataPoint, processed, 'USCBBS', 'fed', params.fed_active, missingDataSymbols);
      this.processSymbolData(dataPoint, processed, 'RRPONTSYD', 'rrp', params.rrp_active, missingDataSymbols);
      this.processSymbolData(dataPoint, processed, 'WTREGEN', 'tga', params.tga_active, missingDataSymbols);
      
      // 处理需要汇率转换的央行数据
      if (params.ecb_active) {
        this.processSymbolData(dataPoint, processed, 'EUCBBS', 'ecb', true, missingDataSymbols, processed.eurusd);
      }
      if (params.pbc_active) {
        this.processSymbolData(dataPoint, processed, 'CNCBBS', 'pbc', true, missingDataSymbols, processed.cnyusd);
      }
      if (params.boj_active) {
        this.processSymbolData(dataPoint, processed, 'JPCBBS', 'boj', true, missingDataSymbols, processed.jpyusd);
      }
      
      // 其他央行数据
      if (params.other_active) {
        // 创建临时变量存储各央行数据
        let otherCbTotal = 0;
        
        // 英国央行
        const boe = this.getSymbolValueWithRate(dataPoint, 'GBCBBS', processed.gbpusd, missingDataSymbols, processed, 'boe');
        otherCbTotal += boe;
        
        // 加拿大央行
        const boc = this.getSymbolValueWithRate(dataPoint, 'CACBBS', processed.cadusd, missingDataSymbols, processed, 'boc');
        otherCbTotal += boc;
        
        // 澳大利亚央行
        const rba = this.getSymbolValueWithRate(dataPoint, 'AUCBBS', processed.audusd, missingDataSymbols, processed, 'rba');
        otherCbTotal += rba;
        
        // 印度央行
        const rbi = this.getSymbolValueWithRate(dataPoint, 'INCBBS', processed.inrusd, missingDataSymbols, processed, 'rbi');
        otherCbTotal += rbi;
        
        // 瑞士央行
        const snb = this.getSymbolValueWithRate(dataPoint, 'CHCBBS', processed.chfusd, missingDataSymbols, processed, 'snb');
        otherCbTotal += snb;
        
        // 俄罗斯央行
        const cbr = this.getSymbolValueWithRate(dataPoint, 'RUCBBS', processed.rubusd, missingDataSymbols, processed, 'cbr');
        otherCbTotal += cbr;
        
        // 巴西央行
        const bcb = this.getSymbolValueWithRate(dataPoint, 'BRCBBS', processed.brlusd, missingDataSymbols, processed, 'bcb');
        otherCbTotal += bcb;
        
        // 韩国央行
        const bok = this.getSymbolValueWithRate(dataPoint, 'KRCBBS', processed.krwusd, missingDataSymbols, processed, 'bok');
        otherCbTotal += bok;
        
        // 新西兰央行
        const rbzn = this.getSymbolValueWithRate(dataPoint, 'NZCBBS', processed.audusd, missingDataSymbols, processed, 'rbzn');
        otherCbTotal += rbzn;
        
        // 瑞典央行
        const sr = this.getSymbolValueWithRate(dataPoint, 'SECBBS', processed.sekusd, missingDataSymbols, processed, 'sr');
        otherCbTotal += sr;
        
        // 马来西亚央行
        const bnm = this.getSymbolValueWithRate(dataPoint, 'MYCBBS', processed.myrusd, missingDataSymbols, processed, 'bnm');
        otherCbTotal += bnm;
        
        processed.other_cb_total = otherCbTotal;
      }
      
      // 货币供应数据
      this.processSymbolData(dataPoint, processed, 'ECONOMICS:USM2', 'usa', params.usa_active, missingDataSymbols);
      
      if (params.europe_active) {
        this.processSymbolData(dataPoint, processed, 'ECONOMICS:EUM2', 'eu', true, missingDataSymbols, processed.eurusd);
      }
      
      if (params.china_active) {
        this.processSymbolData(dataPoint, processed, 'ECONOMICS:CNM2', 'china', true, missingDataSymbols, processed.cnyusd);
      }
      
      if (params.japan_active) {
        this.processSymbolData(dataPoint, processed, 'ECONOMICS:JPM2', 'japan', true, missingDataSymbols, processed.jpyusd);
      }
      
      // 其他 M2 数据
      if (params.other_m2_active) {
        // 创建临时变量存储各国M2数据
        let otherM2Total = 0;
        
        // 英国M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:GBM2', processed.gbpusd, missingDataSymbols, processed, 'gbm2');
        
        // 加拿大M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:CAM2', processed.cadusd, missingDataSymbols, processed, 'cam2');
        
        // 澳大利亚M3
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:AUM3', processed.audusd, missingDataSymbols, processed, 'aum3');
        
        // 印度M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:INM2', processed.inrusd, missingDataSymbols, processed, 'inm2');
        
        // 瑞士M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:CHM2', processed.chfusd, missingDataSymbols, processed, 'chm2');
        
        // 俄罗斯M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:RUM2', processed.rubusd, missingDataSymbols, processed, 'rum2');
        
        // 巴西M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:BRM2', processed.brlusd, missingDataSymbols, processed, 'brm2');
        
        // 韩国M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:KRM2', processed.krwusd, missingDataSymbols, processed, 'krm2');
        
        // 墨西哥M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:MXM2', processed.mxnusd, missingDataSymbols, processed, 'mxm2');
        
        // 印尼M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:IDM2', processed.idrusd, missingDataSymbols, processed, 'idm2');
        
        // 南非M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:ZAM2', processed.zarusd, missingDataSymbols, processed, 'zam2');
        
        // 马来西亚M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:MYM2', processed.myrusd, missingDataSymbols, processed, 'mym2');
        
        // 瑞典M2
        otherM2Total += this.getSymbolValueWithRate(dataPoint, 'ECONOMICS:SEM2', processed.sekusd, missingDataSymbols, processed, 'sem2');
        
        processed.other_m2_total = otherM2Total;
      }
      
      // 计算总量
      let total = 0;
      if (params.fed_active) total += processed.fed || 0;
      if (params.rrp_active) total -= processed.rrp || 0;
      if (params.tga_active) total -= processed.tga || 0;
      if (params.ecb_active) total += processed.ecb || 0;
      if (params.pbc_active) total += processed.pbc || 0;
      if (params.boj_active) total += processed.boj || 0;
      if (params.other_active) total += processed.other_cb_total || 0;
      if (params.usa_active) total += processed.usa || 0;
      if (params.europe_active) total += processed.eu || 0;
      if (params.china_active) total += processed.china || 0;
      if (params.japan_active) total += processed.japan || 0;
      if (params.other_m2_active) total += processed.other_m2_total || 0;
      
      processed.total = total;
      
      processedData.push(processed as GliDataPoint);
    }
    
    // 不再在后端计算技术指标，这些计算将移至前端
    return processedData;
  }

  // 技术指标计算已移至前端
  // calculateIndicators 和 calculateComponentIndicators 方法已移除
}