import { Module } from '@nestjs/common';
import { HowellLiquidityController } from '../controllers/howell-liquidity.controller';
import { HowellLiquidityService } from '../services/howell-liquidity.service';

@Module({
  controllers: [HowellLiquidityController],
  providers: [HowellLiquidityService],
  exports: [HowellLiquidityService]
})
export class HowellLiquidityModule {}
