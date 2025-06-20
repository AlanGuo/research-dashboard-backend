#!/usr/bin/env node

/**
 * BTCDOM2 性能诊断脚本
 * 用于诊断回测性能问题
 */

const { MongoClient } = require('mongodb');

// 配置
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/research_dashboard';
const TEST_START_TIME = new Date('2025-01-01');
const TEST_END_TIME = new Date('2025-06-20');

async function performanceDiagnostics() {
  const client = new MongoClient(MONGO_URL);
  
  try {
    await client.connect();
    console.log('🔗 已连接到MongoDB');
    
    const db = client.db();
    const collection = db.collection('volume_backtests');
    
    console.log('\n📊 数据库基本信息:');
    
    // 1. 数据量统计
    const totalDocs = await collection.countDocuments();
    console.log(`  总文档数: ${totalDocs.toLocaleString()}`);
    
    const testRangeCount = await collection.countDocuments({
      timestamp: { $gte: TEST_START_TIME, $lte: TEST_END_TIME }
    });
    console.log(`  测试时间范围内文档数: ${testRangeCount.toLocaleString()}`);
    
    // 2. 索引状况
    console.log('\n🔍 当前索引状况:');
    const indexes = await collection.indexes();
    indexes.forEach(index => {
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    // 3. 数据大小统计
    const stats = await db.command({ collStats: "volume_backtests" });
    console.log('\n💾 存储统计:');
    console.log(`  数据大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  索引大小: ${(stats.totalIndexSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  平均文档大小: ${(stats.avgObjSize / 1024).toFixed(2)} KB`);
    
    // 4. 查询性能测试
    console.log('\n⚡ 查询性能测试:');
    
    // 测试1: 基础时间范围查询
    console.log('  测试1: 时间范围查询 (无排序)');
    let start = Date.now();
    await collection.find({
      timestamp: { $gte: TEST_START_TIME, $lte: TEST_END_TIME }
    }).limit(10).toArray();
    console.log(`    耗时: ${Date.now() - start}ms`);
    
    // 测试2: 时间范围查询 + 排序
    console.log('  测试2: 时间范围查询 + 排序');
    start = Date.now();
    await collection.find({
      timestamp: { $gte: TEST_START_TIME, $lte: TEST_END_TIME }
    }).sort({ timestamp: 1 }).limit(10).toArray();
    console.log(`    耗时: ${Date.now() - start}ms`);
    
    // 测试3: 完整数据加载 (模拟BTCDOM2回测)
    console.log('  测试3: 完整数据加载 (模拟回测)');
    start = Date.now();
    const fullResults = await collection.find({
      timestamp: { $gte: TEST_START_TIME, $lte: TEST_END_TIME }
    }).sort({ timestamp: 1 }).toArray();
    const fullLoadTime = Date.now() - start;
    console.log(`    耗时: ${fullLoadTime}ms`);
    console.log(`    数据量: ${fullResults.length} 条记录`);
    console.log(`    平均每条记录: ${(fullLoadTime / fullResults.length).toFixed(2)}ms`);
    
    // 5. 查询计划分析
    console.log('\n📋 查询计划分析:');
    const explain = await collection.find({
      timestamp: { $gte: TEST_START_TIME, $lte: TEST_END_TIME }
    }).sort({ timestamp: 1 }).explain('executionStats');
    
    const executionStats = explain.executionStats;
    console.log(`  查询执行时间: ${executionStats.executionTimeMillis}ms`);
    console.log(`  检查的文档数: ${executionStats.totalDocsExamined.toLocaleString()}`);
    console.log(`  返回的文档数: ${executionStats.totalDocsReturned.toLocaleString()}`);
    console.log(`  使用的索引: ${executionStats.winningPlan.inputStage?.indexName || '未使用索引'}`);
    
    // 6. 性能评估
    console.log('\n🎯 性能评估:');
    const efficiency = executionStats.totalDocsReturned / executionStats.totalDocsExamined;
    console.log(`  查询效率: ${(efficiency * 100).toFixed(2)}% (理想值接近100%)`);
    
    if (efficiency < 0.1) {
      console.log(`  ⚠️  查询效率很低，强烈建议优化索引`);
    } else if (efficiency < 0.5) {
      console.log(`  ⚠️  查询效率较低，建议优化索引`);
    } else {
      console.log(`  ✅ 查询效率良好`);
    }
    
    if (fullLoadTime > 5000) {
      console.log(`  ⚠️  完整数据加载时间过长 (${fullLoadTime}ms)，建议优化`);
    } else if (fullLoadTime > 1000) {
      console.log(`  ⚠️  完整数据加载时间较长 (${fullLoadTime}ms)，可以优化`);
    } else {
      console.log(`  ✅ 完整数据加载时间合理 (${fullLoadTime}ms)`);
    }
    
    // 7. 建议
    console.log('\n💡 优化建议:');
    if (executionStats.winningPlan.inputStage?.indexName) {
      console.log(`  ✅ 查询使用了索引: ${executionStats.winningPlan.inputStage.indexName}`);
    } else {
      console.log(`  ❌ 查询未使用索引，这是主要性能问题！`);
      console.log(`     建议运行: node scripts/optimize-db-indexes.js`);
    }
    
    if (stats.totalIndexSize === 0) {
      console.log(`  ❌ 没有任何索引，mongodump恢复可能有问题`);
    }
    
    console.log('\n🎉 诊断完成！');
    
  } catch (error) {
    console.error('❌ 诊断过程中出错:', error);
  } finally {
    await client.close();
  }
}

// 主函数
async function main() {
  console.log('🔍 BTCDOM2 性能诊断工具');
  console.log(`📍 连接地址: ${MONGO_URL}`);
  console.log(`🗓️  测试时间范围: ${TEST_START_TIME.toISOString()} 到 ${TEST_END_TIME.toISOString()}`);
  console.log('=' * 70);
  
  await performanceDiagnostics();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { performanceDiagnostics };
