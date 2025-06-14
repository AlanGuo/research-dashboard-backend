# 币安成交量排行榜回测功能

## 功能说明

这个功能实现了币安交易所每小时成交量排行榜的历史回测，支持以下特性：

- ✅ 每小时计算过去24小时的累计成交量排行榜
- ✅ 支持自定义时间范围（最大7天）
- ✅ 滑动窗口算法，高效处理大量历史数据
- ✅ 支持筛选特定交易对或基准货币
- ✅ 包含市场统计和集中度分析
- ✅ 结果存储到MongoDB，支持历史查询

## API接口

### 1. 执行回测

```bash
POST /api/binance/volume-backtest
```

**请求参数：**
```json
{
  "startTime": "2024-12-01T00:00:00.000Z",
  "endTime": "2024-12-02T00:00:00.000Z",
  "limit": 50,
  "minVolumeThreshold": 10000,
  "quoteAsset": "USDT",
  "symbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT"]
}
```

### 2. 查询历史数据

```bash
GET /api/binance/volume-backtest?date=2024-12-01&hour=12&limit=20
```

### 3. 获取支持的交易对

```bash
GET /api/binance/volume-backtest/symbols?quoteAsset=USDT
```

## 使用示例

### 1. 回测最近24小时的数据

```bash
curl -X POST http://localhost:3000/api/binance/volume-backtest \
  -H "Content-Type: application/json" \
  -d '{
    "startTime": "2024-12-08T00:00:00.000Z",
    "endTime": "2024-12-09T00:00:00.000Z",
    "limit": 50,
    "minVolumeThreshold": 50000,
    "quoteAsset": "USDT"
  }'
```

### 2. 查询特定时间点的排行榜

```bash
curl "http://localhost:3000/api/binance/volume-backtest?date=2024-12-08&hour=15&limit=10"
```

### 3. 查询某个交易对的历史排名

```bash
curl "http://localhost:3000/api/binance/volume-backtest?symbol=BTCUSDT&date=2024-12-08"
```

## 响应格式

```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2024-12-08T15:00:00.000Z",
      "hour": 15,
      "rankings": [
        {
          "rank": 1,
          "symbol": "BTCUSDT",
          "baseAsset": "BTC",
          "quoteAsset": "USDT",
          "volume24h": 12345.67,
          "quoteVolume24h": 987654321.12,
          "marketShare": 15.2,
          "hourlyChange": 0,
          "priceAtTime": 42500.0,
          "volumeChangePercent": 5.3
        }
      ],
      "marketStats": {
        "totalVolume": 123456.78,
        "totalQuoteVolume": 6500000000.00,
        "activePairs": 150,
        "topMarketConcentration": 62.3
      },
      "calculationTime": 1250
    }
  ],
  "meta": {
    "startTime": "2024-12-08T00:00:00.000Z",
    "endTime": "2024-12-09T00:00:00.000Z",
    "totalHours": 24,
    "dataPoints": 24,
    "processingTime": 45000
  }
}
```

## 核心算法

### 滑动窗口实现

```typescript
// 1. 初始化24小时数据窗口
const volumeWindow = {
  symbol: 'BTCUSDT',
  data: [], // 24小时的K线数据
  volume24h: 0,
  quoteVolume24h: 0
};

// 2. 每小时更新窗口
function updateWindow(window, currentHour) {
  // 添加新的1小时数据
  const newKline = getKlineData(window.symbol, currentHour);
  window.data.push(newKline);
  
  // 移除超过24小时的旧数据
  const cutoffTime = currentHour - 24 * 60 * 60 * 1000;
  window.data = window.data.filter(kline => kline.openTime >= cutoffTime);
  
  // 重新计算24小时累计成交量
  window.volume24h = window.data.reduce((sum, kline) => sum + parseFloat(kline.volume), 0);
  window.quoteVolume24h = window.data.reduce((sum, kline) => sum + parseFloat(kline.quoteVolume), 0);
}
```

### 排行榜计算

```typescript
// 1. 过滤有效交易对
const validPairs = volumeWindows.filter(window => 
  window.quoteVolume24h >= minVolumeThreshold
);

// 2. 按成交金额排序
validPairs.sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);

// 3. 计算市场份额
const totalVolume = validPairs.reduce((sum, pair) => sum + pair.quoteVolume24h, 0);
validPairs.forEach((pair, index) => {
  pair.rank = index + 1;
  pair.marketShare = (pair.quoteVolume24h / totalVolume) * 100;
});
```

## 性能优化

1. **批量API调用**：每次处理10个交易对，避免频繁请求
2. **滑动窗口**：复用历史数据，只更新增量部分
3. **缓存机制**：结果存储到MongoDB，支持快速查询
4. **限流控制**：请求间隔100ms，避免触及API限制
5. **数据过滤**：跳过非活跃交易对，减少计算量

## 注意事项

1. **API限制**：币安API有请求频率限制，建议控制并发数
2. **时间范围**：单次回测最大支持7天，避免超时
3. **数据质量**：部分历史数据可能缺失，需要容错处理
4. **内存使用**：大量数据处理时注意内存管理
5. **时区问题**：所有时间使用UTC，避免时区混乱

## 扩展功能

未来可以添加的功能：

- [ ] 异步任务处理，支持大时间范围回测
- [ ] 排名变化趋势分析
- [ ] 成交量波动率计算
- [ ] 多交易所数据对比
- [ ] 实时推送排行榜更新
- [ ] 图表可视化输出
