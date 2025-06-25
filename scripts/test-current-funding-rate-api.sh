#!/bin/bash

# 测试获取回测数据接口是否返回currentFundingRate字段
# 使用方法: ./test-current-funding-rate-api.sh

BASE_URL="http://localhost:4001"
API_PATH="/v1/binance/volume-backtest"

echo "=== 币安成交量回测 - 验证currentFundingRate字段返回测试 ==="
echo ""

# 检查服务是否运行
echo "1. 检查服务状态..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
    echo "❌ 服务未运行，请先启动后端服务"
    echo "   启动命令: cd research-dashboard-backend && yarn start:dev"
    exit 1
fi
echo "✅ 服务正常运行"
echo ""

# 测试获取回测数据（查询最近的一条记录）
echo "2. 获取回测数据并检查currentFundingRate字段..."
RESPONSE=$(curl -s -X GET \
  "${BASE_URL}${API_PATH}?limit=1" \
  -H "Content-Type: application/json")

echo "响应示例（前500字符）:"
echo "$RESPONSE" | head -c 500
echo "..."
echo ""

# 检查是否包含currentFundingRate字段
CURRENT_FUNDING_RATE_COUNT=$(echo "$RESPONSE" | grep -o '"currentFundingRate"' | wc -l | tr -d ' ')
if [ "$CURRENT_FUNDING_RATE_COUNT" -gt 0 ]; then
    echo "✅ currentFundingRate字段存在"
    echo "   找到 $CURRENT_FUNDING_RATE_COUNT 个currentFundingRate字段"
    
    # 提取并显示几个currentFundingRate的值
    echo ""
    echo "📊 currentFundingRate字段示例值:"
    echo "$RESPONSE" | grep -o '"currentFundingRate":[^,}]*' | head -5
else
    echo "❌ currentFundingRate字段不存在"
    echo "   请检查以下内容:"
    echo "   1. 是否已运行异步补充任务"
    echo "   2. 是否有数据包含currentFundingRate字段"
    echo "   3. API返回是否正确映射了该字段"
fi

echo ""

# 检查是否包含fundingRateHistory字段
FUNDING_RATE_HISTORY_COUNT=$(echo "$RESPONSE" | grep -o '"fundingRateHistory"' | wc -l | tr -d ' ')
if [ "$FUNDING_RATE_HISTORY_COUNT" -gt 0 ]; then
    echo "✅ fundingRateHistory字段存在"
    echo "   找到 $FUNDING_RATE_HISTORY_COUNT 个fundingRateHistory字段"
else
    echo "⚠️  fundingRateHistory字段不存在"
fi

echo ""
echo "=== 测试完成 ==="
echo ""
echo "💡 说明："
echo "   - currentFundingRate: 当期可用的最新资金费率（用于选股评分）"
echo "   - fundingRateHistory: 对应时间段的资金费率历史（用于盈亏计算）"
echo "   - 如果currentFundingRate为null，表示该时间点没有可用的资金费率数据"
