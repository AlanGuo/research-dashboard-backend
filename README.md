# Research Dashboard Backend

基于 NestJS 框架构建的金融数据研究看板后端服务，提供全球流动性监控、BTCDOM策略对比等功能的API服务。

## 📋 项目描述

Research Dashboard Backend 是一个专业的金融数据分析后端服务，主要特性：

- **多数据源集成**: TradingView、Notion、宏观经济数据
- **实时数据处理**: WebSocket连接和数据流处理
- **RESTful API**: 提供完整的数据查询和分析接口
- **数据持久化**: MongoDB数据库存储
- **模块化架构**: 基于NestJS的模块化设计
- **容器化部署**: Docker和PM2支持

## 🛠️ 技术栈

- **框架**: NestJS 10.x
- **语言**: TypeScript 5.x
- **数据库**: MongoDB (Mongoose ODM)
- **API集成**: 
  - TradingView WebSocket API
  - Notion API (@notionhq/client)
  - HTTP客户端 (Axios)
- **数据处理**: 
  - 网页抓取 (Cheerio)
  - 文件处理 (JSZip)
  - 数据验证 (class-validator, class-transformer)
- **网络**: WebSocket (ws), 代理支持 (https-proxy-agent)
- **开发工具**: ESLint, Prettier, Jest
- **部署**: PM2, Docker, Docker Compose

## 🚀 安装与运行

### 环境要求
- Node.js 18+
- MongoDB 4.4+
- Yarn (推荐) 或 npm

### 安装依赖
```bash
yarn install
```

### 环境配置
```bash
# 复制环境变量模板
cp .env.example .env

# 编辑环境变量
vi .env
```

### 运行应用

```bash
# 开发模式 (监听文件变化)
yarn start:dev

# 开发模式 (指定环境)
yarn start:dev:env

# 生产模式
yarn start:prod

# 生产模式 (指定环境)
yarn start:prod:env

# 测试环境
yarn start:test:env

# 构建应用
yarn build

# 启动构建后的应用
yarn start

# PM2 部署
yarn pm2
```

### Docker 运行
```bash
# 使用 Docker Compose
docker-compose up -d

# 查看日志
docker-compose logs -f
```

## 🧪 测试

```bash
# 单元测试
yarn test

# 监听模式测试
yarn test:watch

# E2E测试
yarn test:e2e

# 测试覆盖率
yarn test:cov

# 调试模式测试
yarn test:debug
```

## 🔧 开发工具

```bash
# 代码检查
yarn lint

# 代码格式化
yarn format
```

## 📁 项目结构

```
src/
├── config/                    # 配置文件
├── controllers/              # 控制器层
│   ├── app.controller.ts        # 主应用控制器
│   ├── gli.controller.ts        # 全球流动性控制器
│   ├── btcdom.controller.ts     # BTCDOM对比控制器
│   ├── howell-liquidity.controller.ts  # Howell数据控制器
│   ├── asset-trend.controller.ts       # 资产趋势控制器
│   ├── benchmark.controller.ts         # 基准数据控制器
│   └── kline.controller.ts            # K线数据控制器
├── services/                 # 服务层 (业务逻辑)
│   ├── app.service.ts           # 主应用服务
│   ├── gli.service.ts           # 全球流动性服务
│   ├── btcdom.service.ts        # BTCDOM对比服务
│   ├── howell-liquidity.service.ts     # Howell数据服务
│   ├── asset-trend.service.ts          # 资产趋势服务
│   ├── benchmark.service.ts            # 基准数据服务
│   ├── notion.service.ts               # Notion API服务
│   └── tradingview.service.ts          # TradingView API服务
├── modules/                  # 功能模块
│   ├── gli.module.ts            # 全球流动性模块
│   ├── btcdom.module.ts         # BTCDOM对比模块
│   ├── howell-liquidity.module.ts      # Howell数据模块
│   ├── asset-trend.module.ts           # 资产趋势模块
│   ├── benchmark.module.ts             # 基准数据模块
│   ├── notion.module.ts                # Notion集成模块
│   └── tradingview.module.ts           # TradingView集成模块
├── models/                   # 数据模型 (Mongoose)
├── dto/                      # 数据传输对象
├── lib/                      # 核心库和工具
├── utils/                    # 工具函数
├── app.module.ts             # 主应用模块
├── app.controller.spec.ts    # 控制器测试
└── main.ts                   # 应用入口点
```

### 其他重要目录
```
app/                         # 应用配置文件
dist/                        # TypeScript编译输出
scripts/                     # 脚本文件
test/                        # E2E测试文件
docker-data/                 # Docker数据卷
node_modules/                # 依赖包
```

## 🎯 核心功能模块

### 1. 全球流动性指数 (GLI) 模块
- **路径**: `/api/gli`
- **功能**: 
  - 获取各国央行流动性数据
  - M2货币供应量监控
  - 流动性趋势分析
  - 基准对比数据
- **数据源**: 央行官网、宏观经济数据库

### 2. BTCDOM策略对比模块
- **路径**: `/api/btcdom`
- **功能**:
  - 自制策略与币安合约对比
  - 性能指标计算
  - 收益率分析
  - 风险指标评估

### 3. Howell流动性数据模块
- **路径**: `/api/howell-liquidity`
- **功能**:
  - Howell Liquidity数据集成
  - 数据清洗和标准化
  - 历史数据查询

### 4. 资产趋势模块
- **路径**: `/api/asset-trend`
- **功能**:
  - 资产价格趋势分析
  - 技术指标计算
  - 趋势预测

### 5. 基准数据模块
- **路径**: `/api/benchmark`
- **功能**:
  - 基准资产数据
  - 相关性分析
  - 对比基准计算

### 6. TradingView集成
- **功能**:
  - WebSocket实时数据
  - K线数据获取
  - 技术指标计算
  - 多品种数据支持

### 7. Notion集成
- **功能**:
  - 数据库操作
  - 页面创建和更新
  - 结构化数据存储

## 🔌 主要API端点

### GLI相关
```
GET  /api/gli              # 获取GLI数据
GET  /api/gli/trends       # 获取GLI趋势数据
GET  /api/gli/benchmark    # 获取GLI基准对比
```

### BTCDOM相关
```
GET  /api/btcdom           # 获取BTCDOM对比数据
GET  /api/btcdom/performance  # 获取性能指标
```

### 数据管理
```
GET  /api/howell-liquidity # 获取Howell数据
GET  /api/benchmark        # 获取基准数据
POST /api/asset-trend      # 创建资产趋势
GET  /api/kline           # 获取K线数据
```

### 币安成交量回测
```
POST /v1/binance/volume-backtest                    # 执行成交量排行榜回测
GET  /v1/binance/volume-backtest                    # 查询历史回测数据
GET  /v1/binance/volume-backtest/status             # 获取回测任务状态
POST /v1/binance/volume-backtest/cache-cleanup      # 清理过期缓存
```

**查询参数变更 (v2.0):**
- ✅ 新增: `startTime` 和 `endTime` 支持自定义时间范围
- ❌ 移除: `date`、`hour`、`symbol` 参数
- 📝 详细文档: [币安成交量回测功能文档](./docs/binance-volume-backtest/README.md)

## ⚙️ 环境变量配置

创建 `.env` 文件并配置以下变量：

```bash
# 应用配置
NODE_ENV=development
PORT=3001

# 数据库配置
MONGODB_URI=mongodb://localhost:27017/research_dashboard

# Notion API配置
NOTION_API_KEY=your_notion_api_key
NOTION_DATABASE_ID=your_notion_database_id

# TradingView配置
TRADINGVIEW_USERNAME=your_username
TRADINGVIEW_PASSWORD=your_password

# 代理配置 (可选)
HTTP_PROXY=http://proxy:port
HTTPS_PROXY=https://proxy:port

# JWT配置 (如果需要)
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d
```

## 🐳 Docker部署

### Docker Compose (推荐)
```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重新构建
docker-compose up --build
```

### 单独构建
```bash
# 构建镜像
docker build -t research-dashboard-backend .

# 运行容器
docker run -d -p 3001:3001 --name backend research-dashboard-backend
```

## 🚀 生产部署

### PM2部署 (推荐)
```bash
# 使用PM2配置文件
yarn pm2

# 手动PM2启动
pm2 start dist/main.js --name research-backend

# 查看状态
pm2 status

# 查看日志
pm2 logs research-backend

# 重启服务
pm2 restart research-backend
```

### 系统服务
```bash
# 构建生产版本
yarn build

# 启动生产服务
yarn start:prod
```

## 🔍 监控和日志

### PM2监控
```bash
# 实时监控
pm2 monit

# 查看详细信息
pm2 show research-backend
```

### 应用日志
- 开发模式: 控制台输出
- 生产模式: PM2日志文件
- Docker模式: 容器日志

## 🛡️ 安全特性

- **环境变量**: 敏感信息隔离
- **数据验证**: class-validator输入验证
- **错误处理**: 统一异常处理
- **CORS配置**: 跨域请求控制
- **代理支持**: 网络安全配置

## 📈 性能优化

- **连接池**: MongoDB连接池优化
- **缓存策略**: 数据缓存机制
- **异步处理**: 非阻塞I/O操作
- **数据库索引**: 查询优化
- **WebSocket优化**: 实时数据传输

## 🔧 开发建议

### 代码规范
- 使用TypeScript严格模式
- 遵循NestJS最佳实践
- 使用ESLint和Prettier
- 编写单元测试和E2E测试

### 模块开发
1. 在 `modules/` 目录创建模块
2. 在 `controllers/` 目录添加控制器
3. 在 `services/` 目录实现业务逻辑
4. 在 `dto/` 目录定义数据传输对象
5. 在 `models/` 目录创建数据模型

### 调试建议
```bash
# 启用调试模式
yarn start:debug

# 查看详细日志
DEBUG=* yarn start:dev
```

## 🤝 贡献指南

1. Fork项目到你的GitHub账户
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开Pull Request

### 开发流程
- 遵循现有代码风格
- 添加适当的测试
- 更新相关文档
- 确保所有测试通过

## 📝 更新日志

### [0.0.1] - 2024-12-XX
#### 新增
- 初始项目结构
- GLI数据模块
- BTCDOM对比功能
- TradingView集成
- Notion API集成
- Docker支持

#### 技术债务
- [ ] 添加更多单元测试
- [ ] 优化数据库查询
- [ ] 改进错误处理
- [ ] 添加API文档 (Swagger)

## 🔗 相关链接

- [NestJS文档](https://nestjs.com/)
- [MongoDB文档](https://docs.mongodb.com/)
- [TradingView API](https://www.tradingview.com/)
- [Notion API](https://developers.notion.com/)

## 📞 支持

如有问题或建议，请：
- 创建Issue报告bug
- 提交Pull Request贡献代码
- 联系项目维护团队

## 📄 许可证

本项目采用私有许可证，仅供内部使用。

---

**版本**: 0.0.1  
**最后更新**: 2024年12月  
**维护状态**: 积极开发中
