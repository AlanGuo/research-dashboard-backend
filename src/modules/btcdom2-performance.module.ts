import { Module } from "@nestjs/common";
import { Btcdom2PerformanceService } from "../services/btcdom2-performance.service";
import { Btcdom2PerformanceController } from "../controllers/btcdom2-performance.controller";
import { Btcdom2TradingLogsService } from "../services/btcdom2-trading-logs.service";
import { Btcdom2TradingLogsController } from "../controllers/btcdom2-trading-logs.controller";
import { ConfigModule } from "../config/config.module";

@Module({
  imports: [ConfigModule],
  controllers: [Btcdom2PerformanceController, Btcdom2TradingLogsController],
  providers: [Btcdom2PerformanceService, Btcdom2TradingLogsService],
  exports: [Btcdom2PerformanceService, Btcdom2TradingLogsService],
})
export class Btcdom2PerformanceModule {}
