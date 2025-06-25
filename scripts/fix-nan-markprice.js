/**
 * 修复数据库中 markPrice 为 NaN 的历史数据
 * 将所有 NaN 值替换为 null
 */

// MongoDB 连接和修复脚本
const { MongoClient } = require('mongodb');

// 数据库配置
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/research-dashboard';
const DATABASE_NAME = 'research-dashboard';
const COLLECTION_NAME = 'volume_backtests';

async function fixNaNMarkPrice() {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ 连接到 MongoDB');
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    // 查找包含 NaN markPrice 的文档数量
    const countWithNaN = await collection.countDocuments({
      "rankings.fundingRateHistory.markPrice": NaN
    });
    
    console.log(`📊 发现 ${countWithNaN} 个文档包含 NaN markPrice`);
    
    if (countWithNaN === 0) {
      console.log('✅ 没有发现 NaN markPrice，无需修复');
      return;
    }
    
    // 使用聚合管道修复 NaN 值
    const result = await collection.updateMany(
      {"rankings.fundingRateHistory.markPrice": NaN},
      [
        {
          $set: {
            rankings: {
              $map: {
                input: "$rankings",
                as: "ranking",
                in: {
                  $mergeObjects: [
                    "$$ranking",
                    {
                      fundingRateHistory: {
                        $map: {
                          input: { $ifNull: ["$$ranking.fundingRateHistory", []] },
                          as: "funding",
                          in: {
                            $mergeObjects: [
                              "$$funding",
                              {
                                markPrice: {
                                  $cond: [
                                    { $eq: [{ $type: "$$funding.markPrice" }, "double"] },
                                    {
                                      $cond: [
                                        { $ne: ["$$funding.markPrice", "$$funding.markPrice"] }, // NaN 检查
                                        null,
                                        "$$funding.markPrice"
                                      ]
                                    },
                                    "$$funding.markPrice"
                                  ]
                                }
                              }
                            ]
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      ]
    );
    
    console.log(`✅ 修复完成:`);
    console.log(`   - 匹配的文档: ${result.matchedCount}`);
    console.log(`   - 修改的文档: ${result.modifiedCount}`);
    
    // 验证修复结果
    const remainingNaN = await collection.countDocuments({
      "rankings.fundingRateHistory.markPrice": NaN
    });
    
    const nullCount = await collection.countDocuments({
      "rankings.fundingRateHistory.markPrice": null
    });
    
    console.log(`📊 修复后统计:`);
    console.log(`   - 剩余 NaN markPrice: ${remainingNaN}`);
    console.log(`   - null markPrice 数量: ${nullCount}`);
    
    if (remainingNaN === 0) {
      console.log('🎉 所有 NaN markPrice 已成功修复为 null');
    } else {
      console.log('⚠️ 仍有部分 NaN markPrice 未修复，可能需要手动处理');
    }
    
  } catch (error) {
    console.error('❌ 修复过程中发生错误:', error);
    throw error;
  } finally {
    await client.close();
    console.log('✅ 数据库连接已关闭');
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  fixNaNMarkPrice()
    .then(() => {
      console.log('✅ 修复脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 修复脚本执行失败:', error);
      process.exit(1);
    });
}

module.exports = { fixNaNMarkPrice };
