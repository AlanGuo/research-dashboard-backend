import { Module } from '@nestjs/common';
import { ChangeController } from '../controllers/change.controller';
import { ChangeService } from '../services/change.service';
import { NotionModule } from './notion.module';

@Module({
  imports: [NotionModule],
  controllers: [ChangeController],
  providers: [ChangeService],
})
export class ChangeModule {}
