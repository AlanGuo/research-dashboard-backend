const axios = require('axios');
const { performance } = require('perf_hooks');

// 配置
const API_BASE_URL = 'http://localhost:4001/v1/binance/volume-backtest';
const TEST_CONFIG = {
  // 基础测试配置
  basic: {
    startTime: '2024-12-01T00:00:00.000Z',
    endTime: '2024-12-01T08:00:00.000Z',
    limit: 20,
    minVolumeThreshold: 50000,
    quoteAsset: 'USDT',
    granularityHours: 4,
    concurrency: 5,
    minHistoryDays: 180,
    requireFutures: false,
    excludeStablecoins: true,
  },
  // 高并发测试配置
  highConcurrency: {
    startTime: '2024-12-01T00:00:00.000Z',
    endTime: '2024-12-01T12:00:00.000Z',
    limit: 50,
    minVolumeThreshold: 10000,
    quoteAsset: 'USDT',
    granularityHours: 6,
    concurrency: 15,
    minHistoryDays: 365,
    requireFutures: false,
    excludeStablecoins: true,
  },
  // 长时间测试配置
  longDuration: {
    startTime: '2024-11-25T00:00:00.000Z',
    endTime: '2024-11-27T00:00:00.000Z',
    limit: 30,
    minVolumeThreshold: 25000,
    quoteAsset: 'USDT',
    granularityHours: 8,
    concurrency: 8,
    minHistoryDays: 365,
    requireFutures: false,
    excludeStablecoins: true,
  }
};

class ConcurrentPerformanceTester {
  constructor() {
    this.results = {
      tests: [],
      summary: {},
      startTime: Date.now(),
    };
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const prefix = {
      'INFO': '📋',
      'SUCCESS': '✅',
      'ERROR': '❌',
      'WARN': '⚠️',
      'PERF': '⚡'
    }[level] || '📋';
    
    console.log(`${prefix} [${timestamp.slice(11, 19)}] ${message}`);
  }

  async testApiConnection() {
    this.log('测试API连接...', 'INFO');
    try {
      const response = await axios.get(`${API_BASE_URL}/test-connection`, {
        timeout: 10000
      });
      
      if (response.data.success) {
        this.log('API连接测试成功', 'SUCCESS');
        return true;
      } else {
        throw new Error('API连接测试失败');
      }
    } catch (error) {
      this.log(`API连接失败: ${error.message}`, 'ERROR');
      return false;
    }
  }

  async testConcurrentFiltering() {
    this.log('测试并发筛选功能...', 'INFO');
    
    const testSymbols = [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT',
      'SOLUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'SHIBUSDT',
      'MATICUSDT', 'LTCUSDT', 'TRXUSDT', 'LINKUSDT', 'ATOMUSDT',
      'ETCUSDT', 'XLMUSDT', 'BCHUSDT', 'FILUSDT', 'VETUSDT'
    ];

    const startTime = performance.now();
    
    try {
      const response = await axios.post(`${API_BASE_URL}/filter-concurrent`, {
        symbols: testSymbols,
        minHistoryDays: 180,
        requireFutures: false,
        excludeStablecoins: true,
        concurrency: 8
      }, { timeout: 60000 });

      const endTime = performance.now();
      const duration = endTime - startTime;

      if (response.data.success) {
        const analysis = response.data.data.analysis;
        this.log(`并发筛选测试成功`, 'SUCCESS');
        this.log(`  处理${analysis.totalSymbols}个交易对`, 'PERF');
        this.log(`  有效率: ${analysis.validRate}`, 'PERF');
        this.log(`  耗时: ${(duration/1000).toFixed(2)}秒`, 'PERF');
        this.log(`  吞吐量: ${(analysis.totalSymbols * 1000 / duration).toFixed(1)} 个/秒`, 'PERF');

        return {
          success: true,
          duration,
          throughput: analysis.totalSymbols * 1000 / duration,
          validRate: parseFloat(analysis.validRate.replace('%', '')),
          totalSymbols: analysis.totalSymbols
        };
      } else {
        throw new Error('筛选测试返回失败状态');
      }
    } catch (error) {
      this.log(`并发筛选测试失败: ${error.message}`, 'ERROR');
      return { success: false, error: error.message };
    }
  }

  async runBacktestPerformanceTest(configName, config) {
    this.log(`开始${configName}回测性能测试...`, 'INFO');
    this.log(`  时间范围: ${config.startTime} - ${config.endTime}`, 'INFO');
    this.log(`  并发数: ${config.concurrency}, 粒度: ${config.granularityHours}小时`, 'INFO');

    const startTime = performance.now();
    const startMemory = process.memoryUsage();

    try {
      const response = await axios.post(API_BASE_URL, config, {
        timeout: 300000 // 5分钟超时
      });

      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const duration = endTime - startTime;

      if (response.data.success) {
        const meta = response.data.meta;
        const dataPoints = response.data.data.length;
        
        this.log(`${configName}回测完成`, 'SUCCESS');
        this.log(`  数据点: ${dataPoints}`, 'PERF');
        this.log(`  总耗时: ${(duration/1000).toFixed(2)}秒`, 'PERF');
        this.log(`  服务器处理时间: ${(meta.processingTime/1000).toFixed(2)}秒`, 'PERF');
        this.log(`  数据传输时间: ${((duration - meta.processingTime)/1000).toFixed(2)}秒`, 'PERF');
        this.log(`  内存增长: ${((endMemory.heapUsed - startMemory.heapUsed)/1024/1024).toFixed(1)}MB`, 'PERF');
        this.log(`  吞吐量: ${(dataPoints * 1000 / duration).toFixed(2)} 数据点/秒`, 'PERF');

        return {
          success: true,
          configName,
          duration,
          serverProcessingTime: meta.processingTime,
          dataTransferTime: duration - meta.processingTime,
          dataPoints,
          memoryIncrease: (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024,
          throughput: dataPoints * 1000 / duration,
          symbolStats: meta.symbolStats,
          totalHours: meta.totalHours,
          weeklyCalculations: meta.weeklyCalculations
        };
      } else {
        throw new Error('回测返回失败状态');
      }
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      this.log(`${configName}回测失败: ${error.message}`, 'ERROR');
      this.log(`  失败耗时: ${(duration/1000).toFixed(2)}秒`, 'ERROR');
      
      return { 
        success: false, 
        configName, 
        error: error.message,
        duration 
      };
    }
  }

  async testMemoryLeaks() {
    this.log('开始内存泄漏测试...', 'INFO');
    
    const iterations = 3;
    const memorySnapshots = [];
    
    for (let i = 1; i <= iterations; i++) {
      const beforeMemory = process.memoryUsage();
      memorySnapshots.push({ iteration: i, before: beforeMemory });
      
      this.log(`内存测试第${i}/${iterations}轮...`, 'INFO');
      
      // 执行一个小型回测
      const smallConfig = {
        ...TEST_CONFIG.basic,
        endTime: '2024-12-01T04:00:00.000Z', // 缩短到4小时
        granularityHours: 2,
        limit: 10
      };
      
      await this.runBacktestPerformanceTest(`内存测试轮${i}`, smallConfig);
      
      // 强制垃圾回收（如果支持的话）
      if (global.gc) {
        global.gc();
      }
      
      const afterMemory = process.memoryUsage();
      memorySnapshots[i-1].after = afterMemory;
      
      const memoryDiff = (afterMemory.heapUsed - beforeMemory.heapUsed) / 1024 / 1024;
      this.log(`第${i}轮内存变化: ${memoryDiff > 0 ? '+' : ''}${memoryDiff.toFixed(1)}MB`, 'PERF');
      
      // 轮次间暂停
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return memorySnapshots;
  }

  async runConcurrentRequestsTest() {
    this.log('开始并发请求测试...', 'INFO');
    
    const concurrentRequests = 3;
    const requests = [];
    
    for (let i = 1; i <= concurrentRequests; i++) {
      const config = {
        ...TEST_CONFIG.basic,
        startTime: `2024-12-0${i}T00:00:00.000Z`,
        endTime: `2024-12-0${i}T06:00:00.000Z`,
        granularityHours: 3
      };
      
      requests.push(
        this.runBacktestPerformanceTest(`并发请求${i}`, config)
      );
    }
    
    const startTime = performance.now();
    const results = await Promise.allSettled(requests);
    const endTime = performance.now();
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;
    
    this.log(`并发请求测试完成: ${successful}成功, ${failed}失败`, successful === results.length ? 'SUCCESS' : 'WARN');
    this.log(`并发处理总耗时: ${((endTime - startTime)/1000).toFixed(2)}秒`, 'PERF');
    
    return {
      totalRequests: concurrentRequests,
      successful,
      failed,
      totalDuration: endTime - startTime,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason })
    };
  }

  generateReport() {
    const totalDuration = Date.now() - this.results.startTime;
    
    console.log('\n' + '='.repeat(80));
    console.log('🎯 并发性能测试报告');
    console.log('='.repeat(80));
    console.log(`测试开始时间: ${new Date(this.results.startTime).toISOString()}`);
    console.log(`测试总耗时: ${(totalDuration/1000/60).toFixed(2)}分钟`);
    console.log(`执行的测试数量: ${this.results.tests.length}`);
    
    // 成功率统计
    const successfulTests = this.results.tests.filter(t => t.success).length;
    const successRate = (successfulTests / this.results.tests.length * 100).toFixed(1);
    console.log(`测试成功率: ${successRate}% (${successfulTests}/${this.results.tests.length})`);
    
    // 性能统计
    const performanceTests = this.results.tests.filter(t => t.success && t.throughput);
    if (performanceTests.length > 0) {
      const avgThroughput = performanceTests.reduce((sum, t) => sum + t.throughput, 0) / performanceTests.length;
      const maxThroughput = Math.max(...performanceTests.map(t => t.throughput));
      const minThroughput = Math.min(...performanceTests.map(t => t.throughput));
      
      console.log('\n📊 性能指标:');
      console.log(`  平均吞吐量: ${avgThroughput.toFixed(2)} 数据点/秒`);
      console.log(`  最大吞吐量: ${maxThroughput.toFixed(2)} 数据点/秒`);
      console.log(`  最小吞吐量: ${minThroughput.toFixed(2)} 数据点/秒`);
    }
    
    // 内存使用统计
    const memoryTests = this.results.tests.filter(t => t.success && t.memoryIncrease !== undefined);
    if (memoryTests.length > 0) {
      const avgMemory = memoryTests.reduce((sum, t) => sum + t.memoryIncrease, 0) / memoryTests.length;
      const maxMemory = Math.max(...memoryTests.map(t => t.memoryIncrease));
      
      console.log('\n💾 内存使用:');
      console.log(`  平均内存增长: ${avgMemory.toFixed(1)}MB`);
      console.log(`  最大内存增长: ${maxMemory.toFixed(1)}MB`);
    }
    
    console.log('\n' + '='.repeat(80));
  }

  async run() {
    this.log('🚀 开始并发性能测试套件', 'INFO');
    
    try {
      // 1. API连接测试
      const connectionOk = await this.testApiConnection();
      if (!connectionOk) {
        this.log('API连接失败，终止测试', 'ERROR');
        return;
      }
      
      // 2. 并发筛选测试
      this.log('\n🔍 执行并发筛选测试...', 'INFO');
      const filteringResult = await this.testConcurrentFiltering();
      this.results.tests.push(filteringResult);
      
      // 3. 基础回测性能测试
      this.log('\n📊 执行基础回测性能测试...', 'INFO');
      const basicResult = await this.runBacktestPerformanceTest('基础配置', TEST_CONFIG.basic);
      this.results.tests.push(basicResult);
      
      // 4. 高并发回测测试
      this.log('\n⚡ 执行高并发回测测试...', 'INFO');
      const highConcurrencyResult = await this.runBacktestPerformanceTest('高并发配置', TEST_CONFIG.highConcurrency);
      this.results.tests.push(highConcurrencyResult);
      
      // 5. 内存泄漏测试
      this.log('\n💾 执行内存泄漏测试...', 'INFO');
      const memoryResults = await this.testMemoryLeaks();
      this.results.memorySnapshots = memoryResults;
      
      // 6. 并发请求测试
      this.log('\n🔄 执行并发请求测试...', 'INFO');
      const concurrentResult = await this.runConcurrentRequestsTest();
      this.results.concurrentRequests = concurrentResult;
      
      // 7. 长时间测试（可选，取决于时间）
      const args = process.argv.slice(2);
      if (args.includes('--full')) {
        this.log('\n⏰ 执行长时间回测测试...', 'INFO');
        const longResult = await this.runBacktestPerformanceTest('长时间配置', TEST_CONFIG.longDuration);
        this.results.tests.push(longResult);
      } else {
        this.log('\n⏰ 跳过长时间测试 (使用 --full 参数启用)', 'WARN');
      }
      
    } catch (error) {
      this.log(`测试套件执行出错: ${error.message}`, 'ERROR');
      console.error(error.stack);
    } finally {
      // 生成报告
      this.generateReport();
      
      // 保存详细结果到文件
      const fs = require('fs');
      const reportPath = `performance-test-${Date.now()}.json`;
      fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
      this.log(`详细测试结果已保存到: ${reportPath}`, 'INFO');
    }
  }
}

// 主执行函数
async function main() {
  const tester = new ConcurrentPerformanceTester();
  await tester.run();
}

// 捕获未处理的异常
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未处理的Promise拒绝:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ 未捕获的异常:', error);
  process.exit(1);
});

// 运行测试
if (require.main === module) {
  main().catch(error => {
    console.error('❌ 测试执行失败:', error);
    process.exit(1);
  });
}

module.exports = ConcurrentPerformanceTester;