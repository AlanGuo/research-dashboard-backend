import { Module } from '@nestjs/common';
import { AppController } from './controllers/app.controller';
import { AppService } from './services/app.service';
import { ConfigModule } from './config';
import { NotionModule } from './modules/notion.module';
import { RealtimeModule } from './modules/realtime.module';
import { BaseinfoModule } from './modules/baseinfo.module';
import { TradingViewModule } from './modules/tradingview.module';
import { HoldingModule } from './modules/holding.module';

@Module({
  imports: [ConfigModule, NotionModule, RealtimeModule, BaseinfoModule, TradingViewModule, HoldingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
