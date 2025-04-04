import { Controller, Get, Param, Query } from '@nestjs/common';
import { RealtimeService } from '../services/realtime.service';

@Controller('api/realtime')
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * Get realtime funding data for a specific user
   * @param user User identifier (e.g., 'pumpkin')
   * @returns Realtime funding data from Notion
   */
  @Get(':user')
  async getRealtimeData(@Param('user') user: string) {
    return this.realtimeService.getRealtimeData(user);
  }
}
