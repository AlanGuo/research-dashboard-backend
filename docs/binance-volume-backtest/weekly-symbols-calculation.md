# 周期性Symbols计算功能文档

## 概述

本功能实现了每周一0点(UTC+0)重新计算符合条件的交易对列表，并在回测过程中使用对应周期的symbols进行计算的需求。

## 核心功能

### 1. 周一时间点计算

当调用 `/v1/binance/volume-backtest` 接口时，系统会：

1. 根据传入的 `startTime` 往前找到对应的周一0点(UTC+0)
2. 计算回测时间范围内所有的周一时间点
3. 为每个周一时间点单独计算符合条件的交易对列表

```typescript
// 示例：如果startTime是2024-12-10 15:30:00，系统会找到2024-12-09 00:00:00作为起始周一
private getWeeklySymbolCalculationTimes(startTime: Date, endTime: Date): Date[]
```

### 2. 周期性Symbols筛选

系统为每个周一时间点执行以下筛选逻辑：

- **历史数据要求**: 检查交易对在该时间点是否有足够的历史数据（默认365天）
- **期货合约要求**: 可选择是否要求交易对有对应的永续合约
- **稳定币过滤**: 可选择是否排除稳定币交易对
- **交易量过滤**: 过滤掉成交量过低的交易对

### 3. 缓存机制

- **缓存Key**: 基于周一时间点和筛选参数生成唯一哈希
- **缓存内容**: 包含有效交易对列表、无效交易对及原因、处理统计信息
- **缓存失效**: 自动清理过期缓存数据
- **缓存命中**: 相同筛选条件下直接使用缓存结果

## API接口

### POST /v1/binance/volume-backtest

执行回测，支持周期性symbols计算。

**请求参数:**
```json
{
  "startTime": "2024-12-01T00:00:00.000Z",
  "endTime": "2024-12-08T00:00:00.000Z",
  "limit": 50,
  "minVolumeThreshold": 10000,
  "quoteAsset": "USDT",
  "minHistoryDays": 365,
  "requireFutures": false,
  "granularityHours": 1,
  "excludeStablecoins": true,
  "concurrency": 5
}
```

**响应示例:**
```json
{
  "success": true,
  "data": [...],
  "meta": {
    "startTime": "2024-12-01T00:00:00.000Z",
    "endTime": "2024-12-08T00:00:00.000Z",
    "totalHours": 168,
    "dataPoints": 168,
    "processingTime": 45000,
    "symbolStats": {
      "totalDiscovered": 200,
      "validSymbols": 45,
      "invalidSymbols": 155,
      "validRate": "22.5%",
      "weeklyBreakdown": [
        {
          "weekStart": "2024-11-25",
          "validSymbols": 42,
          "invalidSymbols": 158,
          "validRate": "21.0%",
          "sampleSymbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT", "ADAUSDT", "XRPUSDT"]
        },
        {
          "weekStart": "2024-12-02",
          "validSymbols": 48,
          "invalidSymbols": 152,
          "validRate": "24.0%",
          "sampleSymbols": ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "DOGEUSDT"]
        }
      ]
    },
    "weeklyCalculations": 2
  }
}
```

### GET /v1/binance/volume-backtest

查询历史回测数据。

**查询参数:**
- `date`: 查询特定日期的数据
- `hour`: 查询特定小时的数据
- `limit`: 限制返回的排行榜数量
- `symbol`: 查询特定交易对的历史排名

## 工作流程

### 1. 回测执行流程

```
1. 解析startTime和endTime
2. 计算周一时间点列表
3. 为每个周一计算或获取缓存的symbols
4. 执行周期性symbols回测计算
5. 保存结果到数据库
6. 返回汇总结果
```

### 2. 单时间点计算流程

```
1. 确定当前时间对应的周一
2. 获取该周的symbols列表
3. 创建24小时滑动窗口
4. 预加载K线数据
5. 计算排行榜
6. 保存结果
```

## 性能优化

### 1. 并发控制

- **并发筛选**: 使用可配置的并发数进行交易对筛选
- **自适应限流**: 根据API响应时间和错误率动态调整并发数
- **批量处理**: 分批处理大量交易对以避免内存压力

### 2. 缓存策略

- **筛选结果缓存**: 缓存每周的筛选结果，避免重复计算
- **缓存失效机制**: 自动清理过期缓存
- **缓存统计**: 提供缓存命中率和存储统计信息

### 3. 错误处理

- **重试机制**: 对失败的API调用进行智能重试
- **降级处理**: 在部分数据获取失败时继续处理其他数据
- **错误统计**: 记录和分析错误模式

## 配置参数

### 核心配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `minHistoryDays` | number | 365 | 最少历史数据天数 |
| `requireFutures` | boolean | false | 是否要求有期货合约 |
| `excludeStablecoins` | boolean | true | 是否排除稳定币 |
| `concurrency` | number | 5 | 并发处理数量 |
| `granularityHours` | number | 1 | 回测时间粒度(小时) |

### 性能配置

| 参数 | 说明 |
|------|------|
| `maxConcurrency` | 最大并发数 |
| `batchSize` | 批处理大小 |
| `requestDelay` | API请求间隔 |

## 监控和调试

### 1. 日志级别

- **INFO**: 主要流程和进度信息
- **DEBUG**: 详细的计算和数据信息
- **WARN**: 警告和降级处理
- **ERROR**: 错误和异常情况

### 2. 性能指标

- 处理时间统计
- API调用成功率
- 缓存命中率
- 数据获取成功率

### 3. 缓存管理接口

```bash
# 获取缓存统计
GET /v1/binance/volume-backtest/cache-stats

# 清理过期缓存
POST /v1/binance/volume-backtest/cache-cleanup
```

## 使用示例

### 基础回测

```bash
curl -X POST http://localhost:4001/v1/binance/volume-backtest \
  -H "Content-Type: application/json" \
  -d '{
    "startTime": "2024-12-01T00:00:00.000Z",
    "endTime": "2024-12-02T00:00:00.000Z",
    "limit": 20,
    "minHistoryDays": 180,
    "excludeStablecoins": true
  }'
```

### 查询特定时间点数据

```bash
curl "http://localhost:4001/v1/binance/volume-backtest?date=2024-12-01&hour=15&limit=10"
```

## 注意事项

1. **时间范围**: 建议单次回测不超过7天，以控制处理时间和资源消耗
2. **API限制**: 遵守Binance API限制，避免过于频繁的请求
3. **数据质量**: 部分历史数据可能缺失，系统会自动处理并记录
4. **缓存空间**: 定期清理过期缓存以释放存储空间

## 故障排除

### 常见问题

1. **回测时间过长**: 减少时间范围或增加granularityHours
2. **内存不足**: 降低concurrency参数或减少batchSize
3. **API限制**: 增加requestDelay或降低并发数
4. **数据不一致**: 检查Binance API状态和网络连接

### 错误代码

- `400`: 参数错误，检查时间格式和参数范围
- `500`: 内部错误，查看日志获取详细信息
- `503`: 服务不可用，通常是API限制或网络问题