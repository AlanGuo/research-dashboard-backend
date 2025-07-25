import { Module } from "@nestjs/common";
import { RedisService } from "../services/redis.service";
import { ConfigModule } from "../config";

@Module({
  imports: [ConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}