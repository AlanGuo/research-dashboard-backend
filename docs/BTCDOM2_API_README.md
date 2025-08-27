# BTCDOM2策略表现API文档

## 概述

这个API提供了访问btcdom2策略实盘表现数据的接口，数据来源于生产数据库 `abtg-btcdom2-binance-prod-2025-08-26` 中的 `btcdom2_performance` 集合。

## 基础URL

```
http://localhost:4001/v1/btcdom2/performance
```

## API端点

### 1. 获取所有表现数据

**GET** `/v1/btcdom2/performance`

获取所有btcdom2策略表现数据，支持时间范围筛选和排序。

#### 查询参数

| 参数 | 类型 | 必需 | 描述 | 示例 |
|------|------|------|------|------|
| `startDate` | string | 否 | 开始日期 (ISO格式) | `2025-06-01T00:00:00.000Z` |
| `endDate` | string | 否 | 结束日期 (ISO格式) | `2025-06-30T23:59:59.999Z` |
| `sortBy` | string | 否 | 排序字段 (默认: market_data_timestamp) | `timestamp` |
| `sortOrder` | string | 否 | 排序方向 asc/desc (默认: desc) | `asc` |
| `limit` | number | 否 | 限制返回数量 | `100` |

#### 示例请求

```bash
curl "http://localhost:4001/v1/btcdom2/performance?startDate=2025-06-29T00:00:00.000Z&endDate=2025-06-29T23:59:59.999Z&limit=10"
```

#### 响应示例

```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2025-06-29T00:02:57.872Z",
      "position_pnl": -463.30718929999966,
      "btc_pnl": 11.172504250000202,
      "futures_pnl": -474.47969354999987,
      "total_fees_usdt": 2.8901598011500003,
      "total_funding_fee_usdt": -8.13793874,
      "total_pnl": -474.33528784114964,
      "total_return_rate": -0.05030212134426458,
      "total_trades": 17,
      "positions_count": 5,
      "market_data_timestamp": "2025-06-29T00:00:00.000Z",
      "execution_id": "2025-06-29T00:02:57.872813135+00:00"
    }
  ],
  "count": 1,
  "query": {
    "startDate": "2025-06-29T00:00:00.000Z",
    "endDate": "2025-06-29T23:59:59.999Z",
    "sortBy": "market_data_timestamp",
    "sortOrder": "desc",
    "limit": 10
  }
}
```

### 2. 按市场数据时间戳范围查询

**GET** `/v1/btcdom2/performance/by-market-timestamp`

根据市场数据时间戳范围获取表现数据。

#### 查询参数

| 参数 | 类型 | 必需 | 描述 | 示例 |
|------|------|------|------|------|
| `startTimestamp` | string | 是 | 开始时间戳 (ISO格式) | `2025-06-29T00:00:00.000Z` |
| `endTimestamp` | string | 是 | 结束时间戳 (ISO格式) | `2025-06-29T23:59:59.999Z` |

#### 示例请求

```bash
curl "http://localhost:4001/v1/btcdom2/performance/by-market-timestamp?startTimestamp=2025-06-29T00:00:00.000Z&endTimestamp=2025-06-29T23:59:59.999Z"
```

### 3. 获取最新表现数据

**GET** `/v1/btcdom2/performance/latest`

获取最新的表现数据记录。

#### 查询参数

| 参数 | 类型 | 必需 | 描述 | 示例 |
|------|------|------|------|------|
| `count` | number | 否 | 获取最新的几条数据 (默认: 1) | `5` |

#### 示例请求

```bash
curl "http://localhost:4001/v1/btcdom2/performance/latest?count=5"
```

### 4. 获取表现统计信息

**GET** `/v1/btcdom2/performance/statistics`

获取表现数据的统计信息，包括总记录数、日期范围和最新表现汇总。

#### 示例请求

```bash
curl "http://localhost:4001/v1/btcdom2/performance/statistics"
```

#### 响应示例

```json
{
  "success": true,
  "data": {
    "totalRecords": 1250,
    "dateRange": {
      "earliest": "2025-06-24T00:00:00.000Z",
      "latest": "2025-06-29T23:59:59.999Z"
    },
    "performanceSummary": {
      "totalPnl": -474.33528784114964,
      "totalReturnRate": -0.05030212134426458,
      "totalTrades": 17,
      "totalFees": 2.8901598011500003,
      "totalFundingFees": -8.13793874
    }
  }
}
```

### 5. 根据执行ID查询

**GET** `/v1/btcdom2/performance/execution/:executionId`

根据执行ID获取特定的表现数据记录。

#### 路径参数

| 参数 | 类型 | 必需 | 描述 | 示例 |
|------|------|------|------|------|
| `executionId` | string | 是 | 执行ID | `2025-06-29T00:02:57.872813135+00:00` |

#### 示例请求

```bash
curl "http://localhost:4001/v1/btcdom2/performance/execution/2025-06-29T00:02:57.872813135+00:00"
```

## 数据字段说明

| 字段 | 类型 | 描述 |
|------|------|------|
| `timestamp` | Date | 记录时间戳 |
| `position_pnl` | number | 持仓盈亏 |
| `btc_pnl` | number | BTC盈亏 |
| `futures_pnl` | number | 期货盈亏 |
| `total_fees_usdt` | number | 总手续费(USDT) |
| `total_funding_fee_usdt` | number | 总资金费率费用(USDT) |
| `total_pnl` | number | 总盈亏 |
| `total_return_rate` | number | 总收益率 |
| `total_trades` | number | 总交易次数 |
| `positions_count` | number | 持仓数量 |
| `market_data_timestamp` | Date | 市场数据时间戳 |
| `execution_id` | string | 执行ID |

## 错误处理

API使用标准的HTTP状态码：

- `200` - 成功
- `400` - 请求参数错误
- `404` - 资源未找到
- `500` - 服务器内部错误

错误响应格式：

```json
{
  "statusCode": 400,
  "message": "无效的开始日期格式，请使用ISO格式",
  "error": "Bad Request"
}
```

## 测试

运行测试脚本：

```bash
node test-btcdom2-api.js
```

## 数据库配置

API连接到生产数据库：
- 数据库名称: `abtg-btcdom2-binance-prod-2025-06-24`
- 集合名称: `btcdom2_performance`
- 连接URL: `mongodb://localhost:27017` (可在配置文件中修改)

## 注意事项

1. 所有时间参数都应使用ISO 8601格式
2. API支持跨域请求 (CORS)
3. 数据按市场数据时间戳降序排列
4. 建议在生产环境中添加认证和限流机制
