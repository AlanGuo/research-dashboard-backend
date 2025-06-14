// Binance API 配置示例用法

import { BinanceService } from '../services/binance.service';
import { ConfigService } from '../config/config.service';

/*
使用示例：

1. 基本 API 调用
const binanceService = new BinanceService(configService);

// 获取服务器时间
const timeData = await binanceService.getServerTime();
console.log('服务器时间:', timeData.localTime);

// 获取交易对信息
const exchangeInfo = await binanceService.getExchangeInfo();
console.log('交易对数量:', exchangeInfo.symbols.length);

// 获取24小时价格数据
const btcTicker = await binanceService.get24hrTicker('BTCUSDT');
console.log('BTC 24小时变化:', btcTicker.priceChangePercent);

// 获取K线数据
const klines = await binanceService.getKlines({
  symbol: 'BTCUSDT',
  interval: '1h',
  limit: 100
});
console.log('获取到', klines.length, '条K线数据');

2. 配置文件设置
在 development.json/production.json 中已添加：
{
  "binance": {
    "api_url": "https://data-api.binance.vision",
    "request_delay": 100
  }
}

3. ConfigService 新增方法
- configService.binanceApiUrl: 获取API地址
- configService.binanceRequestDelay: 获取请求延迟

4. 代理支持
自动检测环境变量 HTTPS_PROXY 或 HTTP_PROXY
如果设置了代理，会自动使用 HttpsProxyAgent

5. 错误处理
统一的错误处理和日志记录
API调用失败时会自动记录详细的错误信息

6. API限流
使用 delay() 方法控制请求频率
await binanceService.delay(); // 使用配置的延迟时间
await binanceService.delay(200); // 使用自定义延迟时间
*/
