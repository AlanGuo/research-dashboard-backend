import { Module } from '@nestjs/common';
import { RealtimeController } from '../controllers/realtime.controller';
import { RealtimeService } from '../services/realtime.service';
import { NotionModule } from './notion.module';

@Module({
  imports: [NotionModule],
  controllers: [RealtimeController],
  providers: [RealtimeService],
})
export class RealtimeModule {}
