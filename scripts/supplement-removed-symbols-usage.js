#!/usr/bin/env node

/**
 * 补充移除交易对数据功能使用示例
 * 
 * 这个脚本演示如何使用新的 supplement-removed-symbols 接口
 * 为现有的回测数据补充 removedSymbols 字段
 */

const axios = require('axios');

// 配置
const CONFIG = {
  baseUrl: 'http://localhost:3000/api/v1/binance/volume-backtest',
  timeout: 300000, // 5分钟超时
};

/**
 * 补充移除交易对数据
 */
async function supplementRemovedSymbols(startTime, endTime, granularityHours = 8) {
  console.log(`🔄 开始补充移除交易对数据...`);
  console.log(`   时间范围: ${startTime} - ${endTime}`);
  console.log(`   粒度: ${granularityHours} 小时`);
  
  try {
    const response = await axios.post(
      `${CONFIG.baseUrl}/supplement-removed-symbols`,
      {
        startTime,
        endTime,
        granularityHours
      },
      {
        timeout: CONFIG.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const result = response.data;
    
    console.log(`✅ 补充完成!`);
    console.log(`   成功处理: ${result.processedCount} 条记录`);
    console.log(`   跳过: ${result.skippedCount} 条记录`);
    console.log(`   错误: ${result.errorCount} 条记录`);
    console.log(`   总耗时: ${(result.totalTime / 1000).toFixed(1)} 秒`);
    
    return result;
  } catch (error) {
    console.error(`❌ 补充失败:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * 查询回测数据并验证 removedSymbols
 */
async function verifyRemovedSymbols(startTime, endTime, limit = 10) {
  console.log(`🔍 验证补充结果...`);
  
  try {
    const response = await axios.get(`${CONFIG.baseUrl}`, {
      params: {
        startTime,
        endTime,
        limit
      }
    });

    const data = response.data;
    
    console.log(`📊 查询结果:`);
    console.log(`   数据点数量: ${data.data.length}`);
    console.log(`   时间粒度: ${data.granularityHours} 小时`);
    
    // 统计 removedSymbols 情况
    let totalRemovedSymbols = 0;
    let recordsWithRemovedSymbols = 0;
    
    data.data.forEach((record, index) => {
      const removedCount = record.removedSymbols?.length || 0;
      totalRemovedSymbols += removedCount;
      
      if (removedCount > 0) {
        recordsWithRemovedSymbols++;
      }
      
      if (index < 3) { // 显示前3条记录的详情
        console.log(`   ${record.timestamp}:`);
        console.log(`     排名交易对: ${record.rankings.length}`);
        console.log(`     移除交易对: ${removedCount}`);
        
        if (removedCount > 0) {
          const symbols = record.removedSymbols.slice(0, 3).map(s => s.symbol);
          console.log(`     移除的交易对: ${symbols.join(', ')}${removedCount > 3 ? '...' : ''}`);
        }
      }
    });
    
    console.log(`📈 统计信息:`);
    console.log(`   总移除交易对数: ${totalRemovedSymbols}`);
    console.log(`   有移除数据的记录: ${recordsWithRemovedSymbols}/${data.data.length}`);
    console.log(`   平均每条记录移除: ${(totalRemovedSymbols / data.data.length).toFixed(1)} 个`);
    
    return data;
  } catch (error) {
    console.error(`❌ 验证失败:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * 批量补充数据（分批处理大时间范围）
 */
async function batchSupplement(startTime, endTime, batchDays = 7, granularityHours = 8) {
  console.log(`🔄 开始批量补充数据...`);
  console.log(`   总时间范围: ${startTime} - ${endTime}`);
  console.log(`   批次大小: ${batchDays} 天`);
  
  const start = new Date(startTime);
  const end = new Date(endTime);
  const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  const batches = Math.ceil(totalDays / batchDays);
  
  console.log(`   总天数: ${totalDays} 天，分为 ${batches} 批次处理`);
  
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  
  for (let i = 0; i < batches; i++) {
    const batchStart = new Date(start.getTime() + i * batchDays * 24 * 60 * 60 * 1000);
    const batchEnd = new Date(Math.min(
      batchStart.getTime() + batchDays * 24 * 60 * 60 * 1000,
      end.getTime()
    ));
    
    console.log(`\n📦 批次 ${i + 1}/${batches}: ${batchStart.toISOString()} - ${batchEnd.toISOString()}`);
    
    try {
      const result = await supplementRemovedSymbols(
        batchStart.toISOString(),
        batchEnd.toISOString(),
        granularityHours
      );
      
      totalProcessed += result.processedCount;
      totalSkipped += result.skippedCount;
      totalErrors += result.errorCount;
      
      // 批次间休息
      if (i < batches - 1) {
        console.log(`⏸️  批次间休息 3 秒...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(`❌ 批次 ${i + 1} 处理失败:`, error.message);
      totalErrors++;
    }
  }
  
  console.log(`\n🎉 批量补充完成!`);
  console.log(`   总处理: ${totalProcessed} 条记录`);
  console.log(`   总跳过: ${totalSkipped} 条记录`);
  console.log(`   总错误: ${totalErrors} 条记录`);
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 补充移除交易对数据工具');
  console.log('==================================');
  
  // 获取命令行参数
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  
  try {
    switch (command) {
      case 'supplement':
        // 补充指定时间范围的数据
        // 用法: node supplement-removed-symbols-usage.js supplement 2024-01-01T00:00:00.000Z 2024-01-02T00:00:00.000Z
        if (args.length < 3) {
          console.error('❌ 用法: supplement <startTime> <endTime> [granularityHours]');
          process.exit(1);
        }
        await supplementRemovedSymbols(args[1], args[2], parseInt(args[3]) || 8);
        break;
        
      case 'verify':
        // 验证指定时间范围的结果
        // 用法: node supplement-removed-symbols-usage.js verify 2024-01-01T00:00:00.000Z 2024-01-02T00:00:00.000Z
        if (args.length < 3) {
          console.error('❌ 用法: verify <startTime> <endTime> [limit]');
          process.exit(1);
        }
        await verifyRemovedSymbols(args[1], args[2], parseInt(args[3]) || 10);
        break;
        
      case 'batch':
        // 批量补充大时间范围的数据
        // 用法: node supplement-removed-symbols-usage.js batch 2024-01-01T00:00:00.000Z 2024-06-16T16:00:00.000Z
        if (args.length < 3) {
          console.error('❌ 用法: batch <startTime> <endTime> [batchDays] [granularityHours]');
          process.exit(1);
        }
        await batchSupplement(
          args[1], 
          args[2], 
          parseInt(args[3]) || 7, 
          parseInt(args[4]) || 8
        );
        break;
        
      case 'demo':
        // 演示模式：补充少量数据并验证
        console.log('🎯 演示模式：补充单日数据并验证');
        const demoStart = '2024-01-01T00:00:00.000Z';
        const demoEnd = '2024-01-02T00:00:00.000Z';
        
        await supplementRemovedSymbols(demoStart, demoEnd);
        console.log('');
        await verifyRemovedSymbols(demoStart, demoEnd, 5);
        break;
        
      case 'full':
        // 全量补充：补充所有历史数据
        console.log('🔥 全量补充模式：补充所有历史数据');
        console.log('⚠️  这将需要很长时间，建议在服务器上运行！');
        
        // 确认操作
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise(resolve => {
          readline.question('是否继续？(yes/no): ', resolve);
        });
        readline.close();
        
        if (answer.toLowerCase() === 'yes') {
          await batchSupplement(
            '2024-01-01T00:00:00.000Z',
            '2024-06-16T16:00:00.000Z',
            7, // 7天一批
            8  // 8小时粒度
          );
        } else {
          console.log('❌ 操作已取消');
        }
        break;
        
      case 'help':
      default:
        console.log('📖 使用说明:');
        console.log('');
        console.log('命令:');
        console.log('  supplement <开始时间> <结束时间> [粒度小时]  - 补充指定时间范围的数据');
        console.log('  verify <开始时间> <结束时间> [限制数量]      - 验证补充结果');
        console.log('  batch <开始时间> <结束时间> [批次天数] [粒度] - 批量补充大时间范围');
        console.log('  demo                                      - 演示模式');
        console.log('  full                                      - 全量补充历史数据');
        console.log('  help                                      - 显示帮助');
        console.log('');
        console.log('示例:');
        console.log('  node supplement-removed-symbols-usage.js demo');
        console.log('  node supplement-removed-symbols-usage.js supplement 2024-01-01T00:00:00.000Z 2024-01-02T00:00:00.000Z');
        console.log('  node supplement-removed-symbols-usage.js verify 2024-01-01T00:00:00.000Z 2024-01-02T00:00:00.000Z');
        console.log('  node supplement-removed-symbols-usage.js batch 2024-01-01T00:00:00.000Z 2024-06-16T16:00:00.000Z 7 8');
        break;
    }
  } catch (error) {
    console.error('❌ 执行失败:', error.message);
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = {
  supplementRemovedSymbols,
  verifyRemovedSymbols,
  batchSupplement
};