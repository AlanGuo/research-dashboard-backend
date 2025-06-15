import { Module } from "@nestjs/common";
import { BtcDomController } from "../controllers/btcdom.controller";
import { BtcDomService } from "../services/btcdom.service";
import { ConfigModule } from "../config";

@Module({
  imports: [ConfigModule],
  controllers: [BtcDomController],
  providers: [BtcDomService],
  exports: [BtcDomService],
})
export class BtcDomModule {}
