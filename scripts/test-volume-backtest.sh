#!/bin/bash

# 币安成交量回测功能测试脚本

API_BASE="http://localhost:4001/api/binance/volume-backtest"

echo "=== 币安成交量回测功能测试 ==="
echo ""

# 1. 测试获取支持的交易对
echo "1. 测试获取支持的交易对..."
curl -s "${API_BASE}/symbols?quoteAsset=USDT" | jq '.data.symbols[0:5]'
echo ""

# 2. 测试执行小范围回测（最近2小时）
echo "2. 测试执行小范围回测..."
START_TIME=$(date -u -d '2 hours ago' +"%Y-%m-%dT%H:00:00.000Z")
END_TIME=$(date -u +"%Y-%m-%dT%H:00:00.000Z")

echo "时间范围: $START_TIME 到 $END_TIME"

curl -s -X POST "${API_BASE}" \
  -H "Content-Type: application/json" \
  -d "{
    \"startTime\": \"$START_TIME\",
    \"endTime\": \"$END_TIME\",
    \"limit\": 10,
    \"minVolumeThreshold\": 1000000,
    \"quoteAsset\": \"USDT\",
    \"symbols\": [\"BTCUSDT\", \"ETHUSDT\", \"BNBUSDT\", \"ADAUSDT\", \"XRPUSDT\"]
  }" | jq '.meta'

echo ""

# 3. 测试查询历史数据
echo "3. 测试查询历史数据..."
QUERY_DATE=$(date -u -d '1 day ago' +"%Y-%m-%d")
curl -s "${API_BASE}?date=${QUERY_DATE}&limit=5" | jq '.data[0].rankings[0:3]'
echo ""

# 4. 测试特定交易对查询
echo "4. 测试特定交易对查询..."
curl -s "${API_BASE}?symbol=BTCUSDT&date=${QUERY_DATE}" | jq '.data[0].rankings[] | select(.symbol == "BTCUSDT")'
echo ""

# 5. 测试错误处理
echo "5. 测试错误处理（无效时间范围）..."
curl -s -X POST "${API_BASE}" \
  -H "Content-Type: application/json" \
  -d "{
    \"startTime\": \"2024-12-10T00:00:00.000Z\",
    \"endTime\": \"2024-12-09T00:00:00.000Z\",
    \"limit\": 10
  }" | jq '.message'

echo ""
echo "=== 测试完成 ==="
