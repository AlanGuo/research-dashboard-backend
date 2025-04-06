import { Controller, Get, Param } from '@nestjs/common';
import { ChangeService } from '../services/change.service';

@Controller('v1/change')
export class ChangeController {
  constructor(private readonly changeService: ChangeService) {}

  /**
   * Get change data for a specific user
   * @param user User identifier (e.g., 'pumpkin')
   * @returns Processed change data sorted by date in descending order
   */
  @Get(':user')
  async getChangeData(@Param('user') user: string) {
    return this.changeService.getChangeData(user);
  }
}
