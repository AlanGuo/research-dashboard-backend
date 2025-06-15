import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AssetTrendController } from "../controllers/asset-trend.controller";
import { AssetTrendService } from "../services/asset-trend.service";
import { AssetTrendModel } from "../models/asset-trend.model";
import { TradingViewModule } from "./tradingview.module";
import { BenchmarkModule } from "./benchmark.module";
import { GliModule } from "./gli.module";
import { GliService } from "src/services/gli.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: "AssetTrend", schema: AssetTrendModel.schema },
    ]),
    TradingViewModule,
    BenchmarkModule,
    GliModule,
  ],
  controllers: [AssetTrendController],
  providers: [AssetTrendService, GliService],
  exports: [AssetTrendService],
})
export class AssetTrendModule {}
