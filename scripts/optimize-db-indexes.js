#!/usr/bin/env node

/**
 * 数据库索引优化脚本
 * 用于为BTCDOM2回测优化MongoDB索引
 */

const { MongoClient } = require('mongodb');

// 配置数据库连接
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/research_dashboard';

async function optimizeIndexes() {
  const client = new MongoClient(MONGO_URL);
  
  try {
    await client.connect();
    console.log('🔗 已连接到MongoDB');
    
    const db = client.db();
    const collection = db.collection('volume_backtests');
    
    console.log('\n📊 当前索引状况:');
    const currentIndexes = await collection.indexes();
    currentIndexes.forEach(index => {
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    console.log('\n🚀 开始优化索引...');
    
    // 1. 删除可能重复或低效的索引（如果存在）
    try {
      await collection.dropIndex({ hour: 1 });
      console.log('✅ 删除了hour单字段索引');
    } catch (e) {
      console.log('⚠️  hour索引不存在，跳过删除');
    }
    
    // 2. 创建核心复合索引 - timestamp和hour的复合索引
    await collection.createIndex(
      { timestamp: 1, hour: 1 },
      { 
        name: 'timestamp_hour_compound',
        background: true 
      }
    );
    console.log('✅ 创建复合索引: timestamp + hour');
    
    // 3. 优化rankings查询索引
    await collection.createIndex(
      { "rankings.symbol": 1, timestamp: 1 },
      { 
        name: 'rankings_symbol_timestamp',
        background: true 
      }
    );
    console.log('✅ 创建复合索引: rankings.symbol + timestamp');
    
    // 4. 为时间范围查询创建专用索引
    await collection.createIndex(
      { timestamp: 1, btcPrice: 1 },
      { 
        name: 'timestamp_btcprice_compound',
        background: true 
      }
    );
    console.log('✅ 创建复合索引: timestamp + btcPrice');
    
    // 5. 检查数据量和统计信息
    const totalDocs = await collection.countDocuments();
    const oldestDoc = await collection.findOne({}, { sort: { timestamp: 1 } });
    const newestDoc = await collection.findOne({}, { sort: { timestamp: -1 } });
    
    console.log('\n📈 数据库统计信息:');
    console.log(`  总文档数: ${totalDocs.toLocaleString()}`);
    if (oldestDoc && newestDoc) {
      console.log(`  时间范围: ${oldestDoc.timestamp.toISOString()} 到 ${newestDoc.timestamp.toISOString()}`);
      const daysDiff = Math.ceil((newestDoc.timestamp - oldestDoc.timestamp) / (1000 * 60 * 60 * 24));
      console.log(`  总天数: ${daysDiff} 天`);
    }
    
    // 6. 验证索引创建结果
    console.log('\n🔍 优化后的索引列表:');
    const newIndexes = await collection.indexes();
    newIndexes.forEach(index => {
      const size = index.size ? `(${(index.size / 1024).toFixed(1)}KB)` : '';
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)} ${size}`);
    });
    
    // 7. 执行查询性能测试
    console.log('\n⚡ 执行性能测试...');
    const testStartTime = new Date('2025-01-01');
    const testEndTime = new Date('2025-06-20');
    
    const start = Date.now();
    const testResults = await collection.find({
      timestamp: { $gte: testStartTime, $lte: testEndTime }
    }).sort({ timestamp: 1 }).limit(1000).toArray();
    const duration = Date.now() - start;
    
    console.log(`  测试查询耗时: ${duration}ms`);
    console.log(`  返回文档数: ${testResults.length}`);
    
    console.log('\n🎉 索引优化完成！');
    
  } catch (error) {
    console.error('❌ 优化过程中出错:', error);
  } finally {
    await client.close();
    console.log('🔌 数据库连接已关闭');
  }
}

// 检查连接和权限的函数
async function checkDatabaseHealth() {
  const client = new MongoClient(MONGO_URL);
  
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('volume_backtests');
    
    // 检查集合是否存在
    const collections = await db.listCollections({ name: 'volume_backtests' }).toArray();
    if (collections.length === 0) {
      throw new Error('volume_backtests 集合不存在！');
    }
    
    // 检查是否有数据
    const count = await collection.countDocuments();
    if (count === 0) {
      throw new Error('volume_backtests 集合为空！');
    }
    
    console.log(`✅ 数据库健康检查通过，共 ${count.toLocaleString()} 条记录`);
    return true;
    
  } catch (error) {
    console.error('❌ 数据库健康检查失败:', error.message);
    return false;
  } finally {
    await client.close();
  }
}

// 主函数
async function main() {
  console.log('🚀 BTCDOM2 数据库索引优化工具');
  console.log(`📍 连接地址: ${MONGO_URL}`);
  console.log('=' * 50);
  
  // 先检查数据库健康状态
  const isHealthy = await checkDatabaseHealth();
  if (!isHealthy) {
    process.exit(1);
  }
  
  // 执行索引优化
  await optimizeIndexes();
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { optimizeIndexes, checkDatabaseHealth };
