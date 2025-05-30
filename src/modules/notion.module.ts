import { Module } from '@nestjs/common';
import { NotionService } from '../services/notion.service';
import { BtcDomService } from '../services/btcdom.service';
import { ConfigModule } from '../config';
import { BtcDomController } from '../controllers/btcdom.controller';

@Module({
  imports: [ConfigModule],
  controllers: [BtcDomController],
  providers: [NotionService, BtcDomService],
  exports: [NotionService, BtcDomService],
})
export class NotionModule {}
