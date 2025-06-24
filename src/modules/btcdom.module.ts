import { Module } from "@nestjs/common";
import { BtcDomController } from "../controllers/btcdom.controller";
import { BtcDomService } from "../services/btcdom.service";
import { ConfigModule } from "../config";
import { TradingViewModule } from "./tradingview.module";
import { RedisModule } from "./redis.module";

@Module({
  imports: [ConfigModule, TradingViewModule, RedisModule],
  controllers: [BtcDomController],
  providers: [BtcDomService],
  exports: [BtcDomService],
})
export class BtcDomModule {}
