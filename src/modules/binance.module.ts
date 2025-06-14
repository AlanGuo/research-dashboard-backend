import { Module } from '@nestjs/common';
import { BinanceService } from '../services/binance.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [BinanceService],
  exports: [BinanceService],
})
export class BinanceModule {}
