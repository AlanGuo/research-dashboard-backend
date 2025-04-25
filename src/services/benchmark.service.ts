import { Injectable } from '@nestjs/common';

export interface BenchmarkAsset {
  id: string;
  name: string;
  symbol: string;
  category: string;
  color: string;
}

@Injectable()
export class BenchmarkService {
  private readonly benchmarks: BenchmarkAsset[] = [
    // 加密货币
    {
      id: 'btcusdt',
      name: '比特币',
      symbol: 'BTCUSDT',
      category: 'crypto',
      color: '#f7931a'
    },
    {
      id: 'ethusdt',
      name: '以太坊',
      symbol: 'ETHUSDT',
      category: 'crypto',
      color: '#627eea'
    },
    
    // 贵金属
    {
      id: 'gold',
      name: '黄金',
      symbol: 'GOLD',
      category: 'precious_metals',
      color: '#ffd700'
    },
    {
      id: 'silver',
      name: '白银',
      symbol: 'SILVER',
      category: 'precious_metals',
      color: '#c0c0c0'
    },
    
    // 大宗商品
    {
      id: 'copper',
      name: '铜',
      symbol: 'COPPER',
      category: 'commodities',
      color: '#b87333'
    },
    {
      id: 'oil',
      name: '原油',
      symbol: 'OIL',
      category: 'commodities',
      color: '#4d4d4d'
    },
    
    // 美国指数
    {
      id: 'dxy',
      name: "美元指数",
      symbol: "DXY",
      category: 'us_indices',
      color: '#21a189'
    },
    {
      id: 'spx',
      name: '标普500',
      symbol: 'SPX',
      category: 'us_indices',
      color: '#21ce99'
    },
    {
      id: 'ndx',
      name: '纳斯达克',
      symbol: 'NDX',
      category: 'us_indices',
      color: '#4d90fe'
    },
    {
      id: 'dji',
      name: '道琼斯',
      symbol: 'DJI',
      category: 'us_indices',
      color: '#0077b5'
    },
    {
      id: 'rut',
      name: '罗素2000',
      symbol: 'RUT',
      category: 'us_indices',
      color: '#6b8e23'
    },
    
    // 债券
    {
      id: 'us10y',
      name: '美国10年期国债',
      symbol: 'US10Y',
      category: 'bonds',
      color: '#8b4513'
    },
    {
      id: 'us30y',
      name: '美国30年期国债',
      symbol: 'US30Y',
      category: 'bonds',
      color: '#a0522d'
    },
    
    // 亚洲指数
    {
      id: 'hsi',
      name: '恒生指数',
      symbol: 'HSI',
      category: 'asia_indices',
      color: '#ff4500'
    },
    {
      id: '000300',
      name: '沪深300',
      symbol: '000300',
      category: 'asia_indices',
      color: '#dc143c'
    },
    {
      id: 'nky',
      name: '日经225',
      symbol: 'NKY',
      category: 'asia_indices',
      color: '#ff69b4'
    },
    
    // 欧洲指数
    {
      id: 'dax',
      name: '德国DAX',
      symbol: 'DAX',
      category: 'europe_indices',
      color: '#ffa500'
    },
    {
      id: 'ftse',
      name: '英国富时100',
      symbol: 'FTSE',
      category: 'europe_indices',
      color: '#1e90ff'
    }
  ];

  getAllBenchmarks(): BenchmarkAsset[] {
    return this.benchmarks;
  }

  getBenchmarkById(id: string): BenchmarkAsset | undefined {
    return this.benchmarks.find(benchmark => benchmark.id === id);
  }

  getBenchmarksByCategory(category: string): BenchmarkAsset[] {
    return this.benchmarks.filter(benchmark => benchmark.category === category);
  }

  getCategories(): string[] {
    const categories = new Set<string>();
    this.benchmarks.forEach(benchmark => categories.add(benchmark.category));
    return Array.from(categories);
  }
}
