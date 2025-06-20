#!/usr/bin/env node

/**
 * BTCDOM2 回测性能分析工具
 * 用于分析回测计算性能瓶颈
 */

const { performance } = require('perf_hooks');

// 模拟一个简化的性能测试
async function performanceAnalysis() {
  console.log('🚀 BTCDOM2 回测性能分析');
  console.log('=' * 50);

  // 1. CPU密集型计算测试
  console.log('\n🔥 CPU性能测试:');
  
  const cpuStart = performance.now();
  let result = 0;
  for (let i = 0; i < 10000000; i++) {
    result += Math.sqrt(i) * Math.sin(i);
  }
  const cpuTime = performance.now() - cpuStart;
  console.log(`  CPU密集计算耗时: ${cpuTime.toFixed(2)}ms`);
  
  // 2. 数组操作性能测试（模拟回测中的数据处理）
  console.log('\n📊 数组操作性能测试:');
  
  const arrayStart = performance.now();
  const testData = Array.from({ length: 1000 }, (_, i) => ({
    symbol: `SYMBOL${i}`,
    price: Math.random() * 100,
    volume: Math.random() * 1000000,
    volatility: Math.random() * 0.1,
    fundingRate: (Math.random() - 0.5) * 0.02
  }));
  
  // 模拟选择做空候选币种的计算
  for (let iteration = 0; iteration < 100; iteration++) {
    const candidates = testData
      .filter(item => item.price > 10)
      .map(item => ({
        ...item,
        priceScore: Math.random(),
        volumeScore: Math.random(),
        volatilityScore: Math.random(),
        fundingRateScore: Math.max(0, Math.min(1, (item.fundingRate + 0.02) / 0.04)),
        totalScore: 0
      }))
      .map(item => ({
        ...item,
        totalScore: item.priceScore * 0.3 + item.volumeScore * 0.1 + 
                   item.volatilityScore * 0.3 + item.fundingRateScore * 0.3
      }))
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 15);
  }
  const arrayTime = performance.now() - arrayStart;
  console.log(`  数组操作耗时: ${arrayTime.toFixed(2)}ms (100次迭代)`);
  
  // 3. JSON序列化性能测试
  console.log('\n🔄 JSON序列化性能测试:');
  
  const jsonStart = performance.now();
  const largeObject = {
    snapshots: Array.from({ length: 500 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      totalValue: Math.random() * 100000,
      btcPosition: {
        symbol: 'BTCUSDT',
        quantity: Math.random() * 10,
        currentPrice: Math.random() * 100000,
        pnl: Math.random() * 1000
      },
      shortPositions: Array.from({ length: 15 }, (_, j) => ({
        symbol: `ALT${j}USDT`,
        quantity: Math.random() * 1000,
        currentPrice: Math.random() * 100,
        pnl: Math.random() * 500,
        fundingRateHistory: Array.from({ length: 10 }, () => ({
          fundingTime: new Date(),
          fundingRate: Math.random() * 0.01,
          markPrice: Math.random() * 100
        }))
      }))
    }))
  };
  
  const jsonString = JSON.stringify(largeObject);
  const jsonTime = performance.now() - jsonStart;
  console.log(`  JSON序列化耗时: ${jsonTime.toFixed(2)}ms`);
  console.log(`  JSON大小: ${(jsonString.length / 1024).toFixed(2)} KB`);
  
  // 4. 内存使用情况
  console.log('\n🧠 内存使用情况:');
  const memUsage = process.memoryUsage();
  console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  External: ${(memUsage.external / 1024 / 1024).toFixed(2)} MB`);
  
  // 5. 系统信息
  console.log('\n💻 系统信息:');
  console.log(`  Node.js版本: ${process.version}`);
  console.log(`  平台: ${process.platform}`);
  console.log(`  架构: ${process.arch}`);
  console.log(`  CPU核心数: ${require('os').cpus().length}`);
  console.log(`  总内存: ${(require('os').totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`  可用内存: ${(require('os').freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
  
  // 6. 性能评估
  console.log('\n🎯 性能评估:');
  if (cpuTime > 500) {
    console.log(`  ⚠️  CPU性能较低 (${cpuTime.toFixed(2)}ms)，可能影响回测速度`);
  } else {
    console.log(`  ✅ CPU性能良好 (${cpuTime.toFixed(2)}ms)`);
  }
  
  if (arrayTime > 200) {
    console.log(`  ⚠️  数组操作较慢 (${arrayTime.toFixed(2)}ms)，可能是算法效率问题`);
  } else {
    console.log(`  ✅ 数组操作性能良好 (${arrayTime.toFixed(2)}ms)`);
  }
  
  if (jsonTime > 100) {
    console.log(`  ⚠️  JSON序列化较慢 (${jsonTime.toFixed(2)}ms)，可能影响响应速度`);
  } else {
    console.log(`  ✅ JSON序列化性能良好 (${jsonTime.toFixed(2)}ms)`);
  }
  
  // 7. 优化建议
  console.log('\n💡 优化建议:');
  console.log('  1. 检查服务器CPU规格是否充足');
  console.log('  2. 考虑添加性能监控和缓存机制');
  console.log('  3. 检查是否有同步阻塞操作');
  console.log('  4. 优化算法复杂度，减少不必要的计算');
  console.log('  5. 考虑使用Worker线程进行CPU密集型计算');
  
  console.log('\n🎉 性能分析完成！');
}

// 简单的回测模拟测试
async function backtestSimulation() {
  console.log('\n🔬 回测计算模拟测试:');
  
  const simulationStart = performance.now();
  
  // 模拟511个数据点的回测计算
  const dataPoints = 511;
  const snapshots = [];
  
  for (let i = 0; i < dataPoints; i++) {
    const snapshot = {
      timestamp: new Date(Date.now() + i * 8 * 60 * 60 * 1000).toISOString(),
      totalValue: Math.random() * 20000,
      btcPosition: {
        symbol: 'BTCUSDT',
        quantity: Math.random() * 1,
        currentPrice: 95000 + Math.random() * 10000,
        pnl: Math.random() * 2000 - 1000
      },
      shortPositions: []
    };
    
    // 模拟选择做空标的的计算
    const candidates = Array.from({ length: 200 }, (_, j) => ({
      symbol: `ALT${j}USDT`,
      priceChange24h: Math.random() * 0.2 - 0.1,
      volume24h: Math.random() * 10000000,
      volatility24h: Math.random() * 0.15,
      fundingRate: (Math.random() - 0.5) * 0.02,
      marketShare: Math.random() * 0.05
    }));
    
    // 计算各种分数（模拟实际回测中的计算）
    const scoredCandidates = candidates.map(candidate => {
      const priceScore = Math.max(0, -candidate.priceChange24h * 5);
      const volumeScore = Math.min(1, candidate.volume24h / 50000000);
      const volatilityScore = 1 - Math.abs(candidate.volatility24h - 0.05) / 0.1;
      const fundingRateScore = Math.max(0, Math.min(1, (candidate.fundingRate + 0.02) / 0.04));
      
      return {
        ...candidate,
        totalScore: priceScore * 0.3 + volumeScore * 0.1 + 
                   volatilityScore * 0.3 + fundingRateScore * 0.3
      };
    });
    
    // 选择前15个做空标的
    const selectedCandidates = scoredCandidates
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 15);
    
    // 计算仓位分配
    const totalMarketShare = selectedCandidates.reduce((sum, c) => sum + c.marketShare, 0);
    const shortAmount = 10000; // 假设做空资金
    
    snapshot.shortPositions = selectedCandidates.map(candidate => ({
      symbol: candidate.symbol,
      quantity: (shortAmount * candidate.marketShare / totalMarketShare) / (candidate.priceChange24h * 100 + 50),
      currentPrice: candidate.priceChange24h * 100 + 50,
      pnl: Math.random() * 1000 - 500,
      fundingRateHistory: Array.from({ length: 8 }, () => ({
        fundingTime: new Date(),
        fundingRate: candidate.fundingRate,
        markPrice: candidate.priceChange24h * 100 + 50
      }))
    }));
    
    snapshots.push(snapshot);
  }
  
  // 计算性能指标
  const returns = [];
  for (let i = 1; i < snapshots.length; i++) {
    const currentValue = snapshots[i].totalValue;
    const previousValue = snapshots[i - 1].totalValue;
    returns.push((currentValue - previousValue) / previousValue);
  }
  
  const totalReturn = (snapshots[snapshots.length - 1].totalValue - snapshots[0].totalValue) / snapshots[0].totalValue;
  const volatility = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length);
  const maxDrawdown = Math.max(...returns.map(r => Math.abs(Math.min(0, r))));
  
  const simulationTime = performance.now() - simulationStart;
  
  console.log(`  模拟${dataPoints}个数据点的回测计算耗时: ${simulationTime.toFixed(2)}ms`);
  console.log(`  平均每个数据点耗时: ${(simulationTime / dataPoints).toFixed(2)}ms`);
  console.log(`  模拟总收益率: ${(totalReturn * 100).toFixed(2)}%`);
  console.log(`  模拟波动率: ${(volatility * 100).toFixed(2)}%`);
  console.log(`  模拟最大回撤: ${(maxDrawdown * 100).toFixed(2)}%`);
  
  return simulationTime;
}

async function main() {
  await performanceAnalysis();
  await backtestSimulation();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { performanceAnalysis, backtestSimulation };
