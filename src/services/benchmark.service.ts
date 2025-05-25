import { Injectable } from '@nestjs/common';

export interface BenchmarkAsset {
  id: string;
  name: string;
  symbol: string;
  category: string;
  color: string;
  lagDays: number; // 滞后天数
}

@Injectable()
export class BenchmarkService {
  private readonly benchmarks: BenchmarkAsset[] = [
    // 加密货币
    {
      id: 'btcusd',
      name: '比特币',
      symbol: 'BTCUSD',
      category: 'crypto',
      color: '#f7931a',
      lagDays: 90,
    },
    {
      id: 'ethusd',
      name: '以太坊',
      symbol: 'ETHUSD',
      category: 'crypto',
      color: '#627eea',
      lagDays: 90,
    },

    // 贵金属
    {
      id: 'gold',
      name: '黄金',
      symbol: 'XAUUSD',
      category: 'precious_metals',
      color: '#ffd700',
      lagDays: 90,
    },
    {
      id: 'silver',
      name: '白银',
      symbol: 'XAGUSD',
      category: 'precious_metals',
      color: '#c0c0c0',
      lagDays: 90,
    },

    // 大宗商品
    {
      id: 'copper',
      name: '铜',
      symbol: 'XCUUSD',
      category: 'commodities',
      color: '#b87333',
      lagDays: 90,
    },
    {
      id: 'oil',
      name: '原油',
      symbol: 'OIL',
      category: 'commodities',
      color: '#4d4d4d',
      lagDays: 90,
    },

    // 美国指数
    {
      id: 'dxy',
      name: '美元指数',
      symbol: 'DXY',
      category: 'us_indices',
      color: '#21a189',
      lagDays: 90,
    },
    {
      id: 'spx',
      name: '标普500',
      symbol: 'SPX',
      category: 'us_indices',
      color: '#21ce99',
      lagDays: 90,
    },
    {
      id: 'ndx',
      name: '纳斯达克',
      symbol: 'NDX',
      category: 'us_indices',
      color: '#4d90fe',
      lagDays: 90,
    },
    {
      id: 'dji',
      name: '道琼斯',
      symbol: 'DJI',
      category: 'us_indices',
      color: '#0077b5',
      lagDays: 90,
    },
    {
      id: 'rut',
      name: '罗素2000',
      symbol: 'RUT',
      category: 'us_indices',
      color: '#6b8e23',
      lagDays: 90,
    },

    // 债券
    {
      id: 'tlt',
      name: 'TLT',
      symbol: 'TLT',
      category: 'bonds',
      color: '#1c9ed7',
      lagDays: 90,
    },
    {
      id: 'us10y',
      name: '美国10年期国债',
      symbol: 'US10Y',
      category: 'bonds',
      color: '#8b4513',
      lagDays: 90,
    },
    {
      id: 'us30y',
      name: '美国30年期国债',
      symbol: 'US30Y',
      category: 'bonds',
      color: '#a0522d',
      lagDays: 90,
    },

    // 亚洲指数
    {
      id: 'hsi',
      name: '恒生指数',
      symbol: 'HSI',
      category: 'asia_indices',
      color: '#ff4500',
      lagDays: 90,
    },
    {
      id: '000300',
      name: '沪深300',
      symbol: '000300',
      category: 'asia_indices',
      color: '#dc143c',
      lagDays: 90,
    },
    {
      id: 'nky',
      name: '日经225',
      symbol: 'NKY',
      category: 'asia_indices',
      color: '#ff69b4',
      lagDays: 90,
    },

    // 欧洲指数
    {
      id: 'dax',
      name: '德国DAX',
      symbol: 'DAX',
      category: 'europe_indices',
      color: '#ffa500',
      lagDays: 90,
    },
    {
      id: 'ftse',
      name: '英国富时100',
      symbol: 'FTSE',
      category: 'europe_indices',
      color: '#1e90ff',
      lagDays: 90,
    },
  ];

  getAllBenchmarks(): BenchmarkAsset[] {
    return this.benchmarks;
  }

  getBenchmarkById(id: string): BenchmarkAsset | undefined {
    return this.benchmarks.find((benchmark) => benchmark.id === id);
  }

  getBenchmarksByCategory(category: string): BenchmarkAsset[] {
    return this.benchmarks.filter(
      (benchmark) => benchmark.category === category,
    );
  }

  getCategories(): string[] {
    const categories = new Set<string>();
    this.benchmarks.forEach((benchmark) => categories.add(benchmark.category));
    return Array.from(categories);
  }

  /**
   * 更新特定基准资产的lagDays属性
   * @param id 基准资产ID
   * @param lagDays 新的滞后天数
   * @returns 更新后的基准资产对象，如果未找到则返回undefined
   */
  updateBenchmarkLagDays(
    id: string,
    lagDays: number,
  ): BenchmarkAsset | undefined {
    const benchmarkIndex = this.benchmarks.findIndex(
      (benchmark) => benchmark.id === id,
    );

    if (benchmarkIndex === -1) {
      return undefined;
    }

    // 更新lagDays属性
    this.benchmarks[benchmarkIndex].lagDays = lagDays;

    return this.benchmarks[benchmarkIndex];
  }
}
