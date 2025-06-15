import { Module } from "@nestjs/common";
import { KlineController } from "../controllers/kline.controller";
import { TradingViewService } from "../services/tradingview.service";

@Module({
  controllers: [KlineController],
  providers: [TradingViewService],
  exports: [TradingViewService],
})
export class TradingViewModule {}
