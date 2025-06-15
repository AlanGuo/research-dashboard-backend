import { Module } from "@nestjs/common";
import { GliController } from "../controllers/gli.controller";
import { GliService } from "../services/gli.service";
import { TradingViewService } from "../services/tradingview.service";

@Module({
  controllers: [GliController],
  providers: [GliService, TradingViewService],
})
export class GliModule {}
