import { Controller, Get, Param, Query } from '@nestjs/common';
import { HoldingService } from '../services/holding.service';

@Controller('api/holding')
export class HoldingController {
  constructor(private readonly holdingService: HoldingService) {}

  /**
   * Get funding holding information for a specific user
   * @param user User identifier (e.g., 'pumpkin')
   * @param status Optional status(es) to filter holdings (comma-separated, e.g., 'active,pending')
   * @param except Optional status(es) to exclude (comma-separated, e.g., 'closed,pending')
   * @returns Funding holding information from Notion
   */
  @Get(':user')
  async getHolding(
    @Param('user') user: string,
    @Query('status') status?: string,
    @Query('except') except?: string
  ) {
    return this.holdingService.getHolding(user, status, except);
  }
}
