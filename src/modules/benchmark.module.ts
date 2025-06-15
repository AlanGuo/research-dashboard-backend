import { Module } from "@nestjs/common";
import { BenchmarkController } from "../controllers/benchmark.controller";
import { BenchmarkService } from "../services/benchmark.service";

@Module({
  controllers: [BenchmarkController],
  providers: [BenchmarkService],
  exports: [BenchmarkService],
})
export class BenchmarkModule {}
