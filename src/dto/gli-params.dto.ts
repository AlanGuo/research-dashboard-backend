import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsIn } from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';

export class GliParamsDto {
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  fed_active?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  tga_active?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  rrp_active?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  ecb_active?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  pbc_active?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  boj_active?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  other_active?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  usa_active?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  europe_active?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  china_active?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  japan_active?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams) => value === 'true' || value === true)
  other_m2_active?: boolean = false;

  // sma_input 和 roc_input 参数已移除，技术指标计算将在前端进行

  @IsOptional()
  @IsNumber()
  @Transform(({ value }: TransformFnParams) => typeof value === 'string' ? parseInt(value, 10) : value)
  limit?: number = 100;

  @IsOptional()
  @IsNumber()
  @Transform(({ value }: TransformFnParams) => value ? (typeof value === 'string' ? parseInt(value, 10) : value) : undefined)
  from?: number;

  @IsOptional()
  @IsString()
  @IsIn(['1D', '1W', '1M'])
  interval?: string = '1D';
}
