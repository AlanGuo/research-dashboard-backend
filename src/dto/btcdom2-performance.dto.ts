import { IsOptional, IsString, IsDateString, IsIn, IsNumberString } from "class-validator";

export class Btcdom2PerformanceQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class Btcdom2PerformanceByMarketTimestampDto {
  @IsDateString()
  startTimestamp: string;

  @IsDateString()
  endTimestamp: string;
}

export class Btcdom2PerformanceLatestDto {
  @IsOptional()
  @IsNumberString()
  count?: string;
}

export class Btcdom2PerformanceResponse {
  success: boolean;
  data: any;
  count?: number;
  query?: any;
  message?: string;
}
