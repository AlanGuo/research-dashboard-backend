import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { VolumeBacktestSchedulerTask } from '../tasks/volume-backtest-scheduler.task';
import { BinanceVolumeBacktestModule } from './binance-volume-backtest.module';
import { ConfigModule } from '../config';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BinanceVolumeBacktestModule,
    ConfigModule,
  ],
  providers: [VolumeBacktestSchedulerTask],
})
export class TasksModule {}
