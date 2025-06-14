#!/bin/bash

# 测试筛选条件缓存功能
# 此脚本测试相同筛选条件的缓存命中效果

echo "🧪 测试筛选条件缓存功能"
echo "========================"

BASE_URL="http://localhost:4001/v1"

# 定义相同的测试参数
START_TIME="2024-12-08T00:00:00.000Z"
END_TIME="2024-12-08T08:00:00.000Z"
MIN_VOLUME_THRESHOLD=400000
MIN_HISTORY_DAYS=365

echo ""
echo "📊 测试1: 第一次执行回测 (应该创建缓存)"
echo "--------------------------------------------"

echo "⏰ 开始时间: $(date)"
FIRST_START=$(date +%s)

curl -s -X POST "${BASE_URL}/binance/volume-backtest" \
  -H "Content-Type: application/json" \
  -d "{
    \"startTime\": \"${START_TIME}\",
    \"endTime\": \"${END_TIME}\",
    \"limit\": 20,
    \"minVolumeThreshold\": ${MIN_VOLUME_THRESHOLD},
    \"minHistoryDays\": ${MIN_HISTORY_DAYS},
    \"requireFutures\": false,
    \"excludeStablecoins\": true,
    \"granularityHours\": 8
  }" | jq -r '
    if .success then
      "✅ 第一次请求成功"
    else
      "❌ 请求失败: " + (.error // "未知错误")
    end,
    "",
    "📊 处理结果:",
    "   - 总处理时间: " + (.meta.processingTime | tostring) + "ms",
    "   - 有效交易对: " + (.meta.symbolStats.validSymbols | tostring),
    "   - 筛选有效率: " + .meta.symbolStats.validRate,
    "",
    "🎯 筛选条件:",
    "   - 历史数据天数: " + (.meta.symbolStats.filterCriteria.minHistoryDays | tostring),
    "   - 需要期货合约: " + (.meta.symbolStats.filterCriteria.requireFutures | tostring),
    "   - 排除稳定币: " + (.meta.symbolStats.filterCriteria.excludeStablecoins | tostring)
  '

FIRST_END=$(date +%s)
FIRST_DURATION=$((FIRST_END - FIRST_START))

echo ""
echo "⏱️ 第一次执行耗时: ${FIRST_DURATION} 秒"

echo ""
echo ""
echo "📊 测试2: 第二次执行相同回测 (应该命中缓存)"
echo "-----------------------------------------------"

echo "⏰ 开始时间: $(date)"
SECOND_START=$(date +%s)

curl -s -X POST "${BASE_URL}/binance/volume-backtest" \
  -H "Content-Type: application/json" \
  -d "{
    \"startTime\": \"${START_TIME}\",
    \"endTime\": \"${END_TIME}\",
    \"limit\": 20,
    \"minVolumeThreshold\": ${MIN_VOLUME_THRESHOLD},
    \"minHistoryDays\": ${MIN_HISTORY_DAYS},
    \"requireFutures\": false,
    \"excludeStablecoins\": true,
    \"granularityHours\": 8
  }" | jq -r '
    if .success then
      "✅ 第二次请求成功 (应该更快)"
    else
      "❌ 请求失败: " + (.error // "未知错误")
    end,
    "",
    "📊 处理结果:",
    "   - 总处理时间: " + (.meta.processingTime | tostring) + "ms",
    "   - 有效交易对: " + (.meta.symbolStats.validSymbols | tostring),
    "   - 筛选有效率: " + .meta.symbolStats.validRate
  '

SECOND_END=$(date +%s)
SECOND_DURATION=$((SECOND_END - SECOND_START))

echo ""
echo "⏱️ 第二次执行耗时: ${SECOND_DURATION} 秒"

echo ""
echo ""
echo "📊 测试3: 不同参数回测 (应该创建新缓存)"
echo "-------------------------------------------"

echo "⏰ 开始时间: $(date)"
THIRD_START=$(date +%s)

curl -s -X POST "${BASE_URL}/binance/volume-backtest" \
  -H "Content-Type: application/json" \
  -d "{
    \"startTime\": \"${START_TIME}\",
    \"endTime\": \"${END_TIME}\",
    \"limit\": 20,
    \"minVolumeThreshold\": 500000,
    \"minHistoryDays\": ${MIN_HISTORY_DAYS},
    \"requireFutures\": false,
    \"excludeStablecoins\": true,
    \"granularityHours\": 8
  }" | jq -r '
    if .success then
      "✅ 不同参数请求成功"
    else
      "❌ 请求失败: " + (.error // "未知错误")
    end,
    "",
    "📊 处理结果:",
    "   - 总处理时间: " + (.meta.processingTime | tostring) + "ms",
    "   - 有效交易对: " + (.meta.symbolStats.validSymbols | tostring),
    "   - 筛选有效率: " + .meta.symbolStats.validRate
  '

THIRD_END=$(date +%s)
THIRD_DURATION=$((THIRD_END - THIRD_START))

echo ""
echo "⏱️ 不同参数执行耗时: ${THIRD_DURATION} 秒"

echo ""
echo ""
echo "📊 测试4: 查看缓存统计信息"
echo "-------------------------"

curl -s -X GET "${BASE_URL}/binance/volume-backtest/cache-stats" | jq -r '
    if .success then
      "✅ 缓存统计获取成功"
    else
      "❌ 获取失败: " + (.error // "未知错误")
    end,
    "",
    "📊 缓存统计:",
    "   - 总缓存数量: " + (.data.totalCaches | tostring),
    "   - 总命中次数: " + (.data.totalHitCount | tostring),
    "   - 平均命中次数: " + (.data.avgHitCount | tostring | .[0:5]),
    "   - 最早缓存: " + (if .data.oldestCache then .data.oldestCache[0:19] else "无" end),
    "   - 最新缓存: " + (if .data.newestCache then .data.newestCache[0:19] else "无" end)
  '

echo ""
echo ""
echo "📈 性能对比分析"
echo "==============="
echo "第一次执行 (创建缓存): ${FIRST_DURATION} 秒"
echo "第二次执行 (命中缓存): ${SECOND_DURATION} 秒"
echo "不同参数执行 (新缓存): ${THIRD_DURATION} 秒"

if [ ${SECOND_DURATION} -lt ${FIRST_DURATION} ]; then
    SPEEDUP=$(echo "scale=1; ${FIRST_DURATION} / ${SECOND_DURATION}" | bc)
    echo ""
    echo "🚀 缓存命中加速比: ${SPEEDUP}x"
    echo "💡 缓存功能正常工作!"
else
    echo ""
    echo "⚠️ 缓存可能未正常工作，第二次执行时间应该更短"
fi

echo ""
echo "✅ 筛选条件缓存功能测试完成"
echo ""
echo "💡 预期结果:"
echo "   - 第一次执行较慢 (需要实际筛选)"
echo "   - 第二次执行更快 (命中缓存)"
echo "   - 不同参数需要重新筛选"
echo "   - 缓存统计显示正确的命中次数"
