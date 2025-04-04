import { Module } from '@nestjs/common';
import { BaseinfoController } from '../controllers/baseinfo.controller';
import { BaseinfoService } from '../services/baseinfo.service';
import { NotionModule } from './notion.module';

@Module({
  imports: [NotionModule],
  controllers: [BaseinfoController],
  providers: [BaseinfoService],
})
export class BaseinfoModule {}
