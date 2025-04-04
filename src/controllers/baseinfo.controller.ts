import { Controller, Get, Param } from '@nestjs/common';
import { BaseinfoService } from '../services/baseinfo.service';

@Controller('v1/baseinfo')
export class BaseinfoController {
  constructor(private readonly baseinfoService: BaseinfoService) {}

  /**
   * Get base price information for a specific user
   * @param user User identifier (e.g., 'pumpkin')
   * @returns Base price information from Notion
   */
  @Get(':user')
  async getBaseInfo(@Param('user') user: string) {
    return this.baseinfoService.getBaseInfo(user);
  }
}
