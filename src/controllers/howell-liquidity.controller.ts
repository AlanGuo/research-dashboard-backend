import { Controller, Get, Query } from '@nestjs/common';
import { HowellLiquidityService } from '../services/howell-liquidity.service';
import { HowellLiquidityResponse } from '../models/howell-liquidity.model';

@Controller('v1/howell-liquidity')
export class HowellLiquidityController {
  constructor(
    private readonly howellLiquidityService: HowellLiquidityService,
  ) {}

  @Get()
  getAllLiquidityData(): HowellLiquidityResponse {
    return this.howellLiquidityService.getAllLiquidityData();
  }

  @Get('revised')
  getRevisedMonthlyData(): HowellLiquidityResponse {
    return this.howellLiquidityService.getRevisedMonthlyData();
  }

  @Get('unrevised')
  getUnrevisedDailyData(): HowellLiquidityResponse {
    return this.howellLiquidityService.getUnrevisedDailyData();
  }

  @Get('latest')
  getLatestData(@Query('count') count?: string): HowellLiquidityResponse {
    const countNum = count ? parseInt(count) : 10;
    return this.howellLiquidityService.getLatestData(countNum);
  }
}
