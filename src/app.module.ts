import { Module } from '@nestjs/common';
import { AppController } from './controllers/app.controller';
import { AppService } from './services/app.service';
import { ConfigModule } from './config';
import { NotionModule } from './modules/notion.module';
import { GliModule } from './modules/gli.module';
import { TradingViewModule } from './modules/tradingview.module';
import { BenchmarkModule } from './modules/benchmark.module';

@Module({
  imports: [ConfigModule, NotionModule, GliModule, TradingViewModule, BenchmarkModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
