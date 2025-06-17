# 补充移除交易对数据功能 (Supplement Removed Symbols)

## 功能概述

该功能用于为已存在的回测数据补充 `removedSymbols` 字段，记录那些从上一期排名中"掉出"前50的交易对在当前时间点的价格和交易数据。

## 业务背景

在成交量排行榜回测中，每8小时会生成一次排名数据。由于市场变化，某些交易对可能会从前一期的排名中消失（跌出前50名）：

```
时间点 T1 (08:00): 排名前50 = [BTCUSDT, ETHUSDT, TRBUSDT, ...]
时间点 T2 (16:00): 排名前50 = [BTCUSDT, ETHUSDT, ADAUSDT, ...]
```

在上面的例子中，`TRBUSDT` 从 T1 排名中消失，但前端需要知道 `TRBUSDT` 在 T2 时间点的价格数据（用于计算收益率等）。

## 数据结构变化

### 1. 数据库模型更新

```typescript
@Schema({ collection: "volume_backtests" })
export class VolumeBacktest {
  // ... 现有字段
  
  @Prop({ type: [Object], default: [] })
  removedSymbols?: HourlyRankingItem[]; // 新增字段
}
```

### 2. API 响应格式更新

```json
{
  "success": true,
  "granularityHours": 8,
  "data": [
    {
      "timestamp": "2024-01-01T08:00:00.000Z",
      "hour": 8,
      "rankings": [ /* 当前排名前50 */ ],
      "removedSymbols": [ /* 从上一期移除的交易对数据 */ ],
      "btcPrice": 42475.23,
      // ... 其他字段
    }
  ]
}
```

## API 接口

### 补充移除交易对数据

**接口地址:** `POST /api/v1/binance/volume-backtest/supplement-removed-symbols`

**请求参数:**

```typescript
{
  startTime: string;      // 开始时间 (ISO 8601 格式)
  endTime: string;        // 结束时间 (ISO 8601 格式)
  granularityHours?: number; // 回测粒度（小时），默认8小时
}
```

**请求示例:**

```json
{
  "startTime": "2024-01-01T00:00:00.000Z",
  "endTime": "2024-06-16T16:00:00.000Z",
  "granularityHours": 8
}
```

**响应格式:**

```json
{
  "success": true,
  "processedCount": 125,    // 成功处理的记录数
  "skippedCount": 15,       // 跳过的记录数
  "errorCount": 2,          // 处理失败的记录数
  "totalTime": 45000        // 总耗时（毫秒）
}
```

## 实现逻辑

### 1. 核心算法

```typescript
// 1. 获取指定时间范围内的所有回测结果，按时间排序
const backtestResults = await this.volumeBacktestModel
  .find({ timestamp: { $gte: startTime, $lte: endTime } })
  .sort({ timestamp: 1 })
  .exec();

// 2. 遍历每条记录，从第二条开始处理（第一条没有"上一期"）
for (let i = 1; i < backtestResults.length; i++) {
  const currentResult = backtestResults[i];
  const previousResult = backtestResults[i - 1];
  
  // 3. 找出从上一期排名中移除的交易对
  const previousSymbols = new Set(previousResult.rankings.map(r => r.symbol));
  const currentSymbols = new Set(currentResult.rankings.map(r => r.symbol));
  const removedSymbolNames = Array.from(previousSymbols).filter(
    symbol => !currentSymbols.has(symbol)
  );
  
  // 4. 为这些移除的交易对获取当前时间点的数据
  const removedSymbolsData = await this.getRemovedSymbolsData(
    removedSymbolNames,
    currentResult.timestamp,
  );
  
  // 5. 更新数据库记录
  await this.volumeBacktestModel.updateOne(
    { _id: currentResult._id },
    { $set: { removedSymbols: removedSymbolsData } }
  );
}
```

### 2. 数据获取策略

对于每个被移除的交易对，系统会：

1. 获取24小时K线数据窗口
2. 计算价格变化、波动率等指标
3. 构造与排名数据相同格式的对象

```typescript
// 示例移除交易对数据
{
  "rank": 1,                    // 在移除列表中的排名
  "symbol": "TRBUSDT",
  "baseAsset": "TRB",
  "quoteAsset": "USDT",
  "priceChange24h": -15.23,     // 24小时价格变化
  "priceAtTime": 45.67,         // 当前价格
  "price24hAgo": 53.89,         // 24小时前价格
  "volume24h": 1234567.89,      // 24小时成交量
  "quoteVolume24h": 56789012.34,// 24小时成交金额
  "marketShare": 0,             // 被移除的交易对市场份额设为0
  "volatility24h": 12.45,       // 24小时波动率
  "high24h": 55.00,             // 24小时最高价
  "low24h": 43.21               // 24小时最低价
}
```

### 3. 错误处理与优化

- **批量处理**: 每批处理10个交易对，避免API限制
- **重试机制**: 获取数据失败时自动重试
- **智能跳过**: 已有数据或时间间隔不匹配的记录会被跳过
- **API限流**: 批次间添加延迟，保护API调用频率

## 使用场景

### 1. 历史数据补充

对于已经存在的2024年1月1日至2024年6月16日的回测数据，一次性补充所有缺失的 `removedSymbols`:

```bash
curl -X POST "http://localhost:3000/api/v1/binance/volume-backtest/supplement-removed-symbols" \
  -H "Content-Type: application/json" \
  -d '{
    "startTime": "2024-01-01T00:00:00.000Z",
    "endTime": "2024-06-16T16:00:00.000Z",
    "granularityHours": 8
  }'
```

### 2. 增量数据补充

对于新增的回测数据，可以只补充最近的数据：

```bash
curl -X POST "http://localhost:3000/api/v1/binance/volume-backtest/supplement-removed-symbols" \
  -H "Content-Type: application/json" \
  -d '{
    "startTime": "2024-06-15T00:00:00.000Z",
    "endTime": "2024-06-16T16:00:00.000Z",
    "granularityHours": 8
  }'
```

## 注意事项

### 1. 数据完整性

- 第一条回测记录不会有 `removedSymbols`，因为没有"上一期"数据
- 如果某个交易对的K线数据获取失败，该交易对不会被包含在 `removedSymbols` 中

### 2. 性能考虑

- 大时间范围的补充操作可能需要较长时间
- API调用频率受到币安API限制影响
- 建议分批处理大量数据

### 3. 幂等性

- 重复调用相同时间范围的补充操作是安全的
- 已存在 `removedSymbols` 数据的记录会被跳过

## 前端使用示例

```typescript
// 获取回测数据，现在包含removedSymbols
const response = await fetch('/api/v1/binance/volume-backtest?startTime=2024-01-01T00:00:00.000Z&endTime=2024-01-02T00:00:00.000Z');
const data = await response.json();

data.data.forEach(timePoint => {
  console.log(`时间点: ${timePoint.timestamp}`);
  console.log(`当前排名: ${timePoint.rankings.length} 个交易对`);
  console.log(`移除交易对: ${timePoint.removedSymbols.length} 个交易对`);
  
  // 处理移除的交易对数据
  timePoint.removedSymbols.forEach(symbol => {
    console.log(`${symbol.symbol}: 价格 ${symbol.priceAtTime}, 变化 ${symbol.priceChange24h}%`);
  });
});
```

## 监控与日志

系统会记录详细的处理日志：

```
🔄 开始补充removedSymbols数据: 2024-01-01T00:00:00.000Z - 2024-06-16T16:00:00.000Z
📊 找到 1234 条回测数据，开始处理...
🔍 2024-01-01T08:00:00.000Z: 找到 3 个移除的交易对: TRBUSDT, ADAUSDT, DOTUSDT
✅ 2024-01-01T08:00:00.000Z: 成功添加 3 个removedSymbols
⏭️ 跳过 2024-01-01T16:00:00.000Z: 已有removedSymbols数据
🎉 补充removedSymbols完成! 处理: 125, 跳过: 15, 错误: 2, 耗时: 45.2s
```
