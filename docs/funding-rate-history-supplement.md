# 资金费率历史数据补充功能

## 概述

为了解决定时任务在最新时间点（00:00:10, 08:00:10, 16:00:10）执行时，未来8小时的 `fundingRateHistory` 数据还没有产生的问题，我们添加了资金费率历史数据补充功能。

## 问题背景

- 定时任务在 00:00:10, 08:00:10, 16:00:10 执行异步回测
- 这些时间点是最新的，未来8小时的资金费率数据还没有产生
- 导致 rankings 中的 `fundingRateHistory` 字段为空或不完整
- 影响后续的盈亏计算和分析

## 解决方案

### 1. 自动补充功能

在定时任务中自动执行资金费率历史数据补充：

```typescript
// 在 VolumeBacktestSchedulerTask.executeScheduledBacktest() 中
// 2. 补充历史数据的资金费率历史（新增）
await this.supplementHistoricalFundingRates();
```

### 2. 手动补充API

提供 REST API 端点用于手动触发补充：

**端点**: `POST /v1/binance/volume-backtest/supplement-funding-rate-history`

**请求参数**:
```json
{
  "startTime": "2024-01-01T00:00:00.000Z",  // 可选，开始时间
  "endTime": "2024-01-02T00:00:00.000Z",    // 可选，结束时间
  "granularityHours": 8                     // 可选，时间粒度（默认8小时）
}
```

**响应示例**:
```json
{
  "success": true,
  "updated": 15,
  "skipped": 3,
  "failed": 0,
  "message": "资金费率历史补充完成: 更新 15 条，跳过 3 条，失败 0 条，耗时 12.34s"
}
```

## 功能特性

### 1. 智能时间范围计算

- 默认查找8小时前的记录（确保未来8小时数据已经可用）
- 默认回填过去24小时内的记录
- 支持自定义时间范围

### 2. 数据完整性检查

- 检查 `fundingRateHistory` 是否为空
- 验证数据是否覆盖完整的时间范围
- 根据时间粒度计算预期的最小记录数

### 3. 批量处理和性能优化

- 批量获取资金费率数据，减少API调用
- 添加适当延迟避免API限制
- 并发控制和重试机制

### 4. 错误处理和日志

- 详细的日志记录处理过程
- 单个记录失败不影响其他记录
- 返回详细的处理统计信息

## 使用示例

### 1. 补充所有缺失数据

```bash
curl -X POST http://localhost:3000/v1/binance/volume-backtest/supplement-funding-rate-history \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 2. 补充指定时间范围的数据

```bash
curl -X POST http://localhost:3000/v1/binance/volume-backtest/supplement-funding-rate-history \
  -H "Content-Type: application/json" \
  -d '{
    "startTime": "2024-01-01T00:00:00.000Z",
    "endTime": "2024-01-02T00:00:00.000Z",
    "granularityHours": 8
  }'
```

### 3. 使用不同的时间粒度

```bash
curl -X POST http://localhost:3000/v1/binance/volume-backtest/supplement-funding-rate-history \
  -H "Content-Type: application/json" \
  -d '{
    "granularityHours": 4
  }'
```

## 技术实现

### 核心方法

1. **supplementFundingRateHistory()**: 主要的补充方法
2. **checkIfNeedsFundingRateUpdate()**: 检查是否需要更新
3. **addFundingRateHistoryToExistingRecord()**: 为现有记录添加数据

### 数据流程

1. 查找需要补充的记录（8小时前的记录）
2. 检查每条记录的 `fundingRateHistory` 完整性
3. 计算时间范围并批量获取资金费率数据
4. 更新数据库记录
5. 返回处理统计信息

### 时间计算逻辑

```typescript
// 对于每条记录
const currentTime = record.timestamp.getTime();
const startTime = currentTime + 10 * 60 * 1000; // 当前时间+10分钟
const endTime = currentTime + (granularityHours * 60 * 60 * 1000) + (10 * 60 * 1000); // granularityHours小时后+10分钟
```

## 注意事项

1. **API限制**: 批量处理时会添加延迟避免触发Binance API限制
2. **数据一致性**: 只更新 `fundingRateHistory`，不修改 `currentFundingRate`
3. **错误恢复**: 单个记录失败不会影响整个批次的处理
4. **性能考虑**: 大量数据补充时可能需要较长时间

## 监控和维护

- 查看应用日志了解补充过程
- 定期检查数据完整性
- 根据需要调整时间范围和粒度参数
