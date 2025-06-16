#!/bin/bash

# 测试 BTC 价格变化率功能的脚本

echo "🧪 测试 BTC 价格变化率功能"
echo "========================================"

# 设置后端 URL
BACKEND_URL="http://localhost:3001"

# 测试参数
START_TIME="2024-12-01T00:00:00Z"
END_TIME="2024-12-01T08:00:00Z"

echo "📅 测试时间范围: $START_TIME - $END_TIME"
echo "🏃‍♂️ 执行回测..."

# 执行回测
curl -X POST "$BACKEND_URL/v1/binance/volume-backtest" \
  -H "Content-Type: application/json" \
  -d "{
    \"startTime\": \"$START_TIME\",
    \"endTime\": \"$END_TIME\",
    \"limit\": 10,
    \"granularityHours\": 8,
    \"minVolumeThreshold\": 1000000
  }" \
  --connect-timeout 300 \
  --max-time 600 \
  > /tmp/backtest_result.json

if [ $? -eq 0 ]; then
  echo "✅ 回测执行成功"
  
  # 检查结果中是否包含 btcPriceChange24h 字段
  if grep -q "btcPriceChange24h" /tmp/backtest_result.json; then
    echo "✅ btcPriceChange24h 字段存在"
    
    # 显示 BTC 价格信息
    echo "📈 BTC 价格信息:"
    jq -r '.data[] | "时间: \(.timestamp), BTC价格: $\(.btcPrice), 24h变化: \(.btcPriceChange24h)%"' /tmp/backtest_result.json
  else
    echo "❌ btcPriceChange24h 字段缺失"
  fi
  
  # 查询已保存的数据
  echo ""
  echo "🔍 查询已保存的数据..."
  curl -X GET "$BACKEND_URL/v1/binance/volume-backtest?startTime=$START_TIME&endTime=$END_TIME&limit=10" \
    -H "Content-Type: application/json" \
    > /tmp/query_result.json
  
  if [ $? -eq 0 ]; then
    echo "✅ 查询成功"
    
    if grep -q "btcPriceChange24h" /tmp/query_result.json; then
      echo "✅ 查询结果包含 btcPriceChange24h 字段"
      
      # 显示查询到的 BTC 价格信息
      echo "📈 查询到的 BTC 价格信息:"
      jq -r '.data[] | "时间: \(.timestamp), BTC价格: $\(.btcPrice), 24h变化: \(.btcPriceChange24h)%"' /tmp/query_result.json
    else
      echo "❌ 查询结果缺失 btcPriceChange24h 字段"
    fi
  else
    echo "❌ 查询失败"
  fi
  
else
  echo "❌ 回测执行失败"
fi

echo ""
echo "🧹 清理临时文件..."
rm -f /tmp/backtest_result.json /tmp/query_result.json

echo "✅ 测试完成"
