import { Module } from '@nestjs/common';
import { AppController } from './controllers/app.controller';
import { AppService } from './services/app.service';
import { ConfigService, ConfigModule } from './config';
import { NotionModule } from './modules/notion.module';
import { GliModule } from './modules/gli.module';
import { TradingViewModule } from './modules/tradingview.module';
import { BenchmarkModule } from './modules/benchmark.module';
import { AssetTrendModule } from './modules/asset-trend.module';
import { HowellLiquidityModule } from './modules/howell-liquidity.module';
import { BtcDomModule } from './modules/btcdom.module';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.connection_url'),
        dbName: configService.get<string>('database.db_name'),
        autoCreate: true,
      }),
      inject: [ConfigService],
    }),
    NotionModule,
    GliModule,
    TradingViewModule,
    BenchmarkModule,
    AssetTrendModule,
    HowellLiquidityModule,
    BtcDomModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
