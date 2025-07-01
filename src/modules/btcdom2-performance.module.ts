import { Module } from "@nestjs/common";
import { Btcdom2PerformanceService } from "../services/btcdom2-performance.service";
import { Btcdom2PerformanceController } from "../controllers/btcdom2-performance.controller";
import { ConfigModule } from "../config/config.module";

@Module({
  imports: [ConfigModule],
  controllers: [Btcdom2PerformanceController],
  providers: [Btcdom2PerformanceService],
  exports: [Btcdom2PerformanceService],
})
export class Btcdom2PerformanceModule {}
