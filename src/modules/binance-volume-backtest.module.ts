import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BinanceVolumeBacktestService } from '../services/binance-volume-backtest.service';
import { BinanceVolumeBacktestController } from '../controllers/binance-volume-backtest.controller';
import { VolumeBacktest, VolumeBacktestSchema } from '../models/volume-backtest.model';
import { ConfigModule } from '../config/config.module';
import { BinanceModule } from './binance.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VolumeBacktest.name, schema: VolumeBacktestSchema },
    ]),
    ConfigModule,
    BinanceModule,
  ],
  controllers: [BinanceVolumeBacktestController],
  providers: [BinanceVolumeBacktestService],
  exports: [BinanceVolumeBacktestService],
})
export class BinanceVolumeBacktestModule {}
