import { Module } from '@nestjs/common';
import { HoldingController } from '../controllers/holding.controller';
import { HoldingService } from '../services/holding.service';
import { NotionModule } from './notion.module';

@Module({
  imports: [NotionModule],
  controllers: [HoldingController],
  providers: [HoldingService],
})
export class HoldingModule {}
