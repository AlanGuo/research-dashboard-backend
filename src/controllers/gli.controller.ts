import { Controller, Get, Query } from '@nestjs/common';
import { GliService } from '../services/gli.service';
import { GliParamsDto } from '../dto/gli-params.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GliTrendResponse } from '../models/gli-trend.model';

@Controller('v1/gli')
export class GliController {
  constructor(private readonly gliService: GliService) {}

  @Get()
  async getGli(@Query() queryParams) {
    // 手动转换参数类型
    const params = plainToInstance(GliParamsDto, queryParams);
    
    // 验证参数
    const errors = await validate(params);
    if (errors.length > 0) {
      return {
        success: false,
        error: 'Invalid parameters',
        errors,
        timestamp: new Date().toISOString()
      };
    }
    
    return this.gliService.getGli(params);
  }
  
  @Get('trend-periods')
  getTrendPeriods(): GliTrendResponse {
    return this.gliService.getTrendPeriods();
  }
}