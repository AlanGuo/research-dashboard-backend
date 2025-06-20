# BTCDOM2 性能优化指南

## 问题描述
服务器上执行 BTCDOM2 回测比本地环境慢很多，主要原因是数据库索引问题。

## 🔍 问题分析

### 核心性能瓶颈
BTCDOM2回测的关键查询：
```javascript
// 按时间范围查询并排序，这是最耗时的操作
db.volume_backtests.find({
  timestamp: { $gte: startTime, $lte: endTime }
}).sort({ timestamp: 1 })
```

### 可能的原因
1. **数据库索引不完整** - mongodump/mongorestore 可能没有正确恢复索引
2. **缺少复合索引** - 单字段索引对复杂查询效率低
3. **服务器硬件性能差异** - CPU、内存、磁盘I/O
4. **网络延迟** - API服务与数据库之间的网络延迟

## 🛠️ 解决方案

### 1. 性能诊断
首先运行诊断脚本检查当前状况：

```bash
cd research-dashboard-backend
node scripts/diagnose-performance.js
```

### 2. 数据库索引优化
运行索引优化脚本：

```bash
# 设置数据库连接地址（如果不是默认地址）
export MONGO_URL="mongodb://your-server:27017/research-dashboard"

# 运行索引优化
node scripts/optimize-db-indexes.js
```

### 3. 验证优化效果
再次运行诊断脚本查看改善情况：

```bash
node scripts/diagnose-performance.js
```

## 📊 预期的索引结构

优化后的索引：
```javascript
// 1. 主查询索引
{ timestamp: 1 }

// 2. 复合索引：时间 + 小时
{ timestamp: 1, hour: 1 }

// 3. 复合索引：交易对 + 时间
{ "rankings.symbol": 1, timestamp: 1 }

// 4. 复合索引：时间 + BTC价格
{ timestamp: 1, btcPrice: 1 }
```

## 🎯 性能指标

### 优化前可能的症状：
- 查询时间：5-30秒
- 查询效率：< 10%
- 未使用索引或使用了低效索引

### 优化后预期效果：
- 查询时间：< 1秒
- 查询效率：> 90%
- 正确使用复合索引

## 🔧 其他优化建议

### 1. 检查mongodump恢复是否完整
```bash
# 检查索引是否正确恢复
db.volume_backtests.getIndexes()

# 查看集合统计信息
db.runCommand({ collStats: "volume_backtests" })
```

### 2. 服务器硬件优化
- 确保有足够的内存供MongoDB使用
- 使用SSD而非HDD存储数据库
- 检查CPU使用率是否过高

### 3. 网络优化
- 将API服务与数据库部署在同一服务器或同一局域网
- 检查网络延迟：`ping your-mongodb-server`

## 🚨 紧急修复

如果索引优化脚本无法解决问题，可以尝试：

### 1. 手动创建核心索引
```javascript
// 连接到MongoDB
use research-dashboard

// 创建最重要的复合索引
db.volume_backtests.createIndex({ timestamp: 1, hour: 1 }, { background: true })
```

### 2. 重新导入数据
```bash
# 如果索引问题严重，重新导入数据
mongodump --db research-dashboard --collection volume_backtests
mongorestore --db research-dashboard --collection volume_backtests --drop
```

## 📞 故障排除

### 常见问题：

**Q: 脚本运行报错"volume_backtests 集合不存在"**
A: 检查数据库名称和集合名称是否正确，确认数据已正确导入

**Q: 优化后性能没有明显改善**
A: 可能是服务器硬件问题，检查CPU、内存、磁盘I/O使用情况

**Q: MongoDB连接失败**
A: 检查MONGO_URL环境变量，确认MongoDB服务正在运行

### 联系方式
如果问题仍然存在，请提供诊断脚本的输出结果以便进一步分析。
