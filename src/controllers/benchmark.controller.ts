import { Controller, Get, Param } from '@nestjs/common';
import { BenchmarkService, BenchmarkAsset } from '../services/benchmark.service';

@Controller('v1/benchmark')
export class BenchmarkController {
  constructor(private readonly benchmarkService: BenchmarkService) {}

  @Get()
  getAllBenchmarks(): BenchmarkAsset[] {
    return this.benchmarkService.getAllBenchmarks();
  }

  @Get(':id')
  getBenchmarkById(@Param('id') id: string): BenchmarkAsset {
    const benchmark = this.benchmarkService.getBenchmarkById(id);
    if (!benchmark) {
      throw new Error(`Benchmark with ID ${id} not found`);
    }
    return benchmark;
  }

  @Get('category/:category')
  getBenchmarksByCategory(@Param('category') category: string): BenchmarkAsset[] {
    return this.benchmarkService.getBenchmarksByCategory(category);
  }

  @Get('categories')
  getCategories(): string[] {
    return this.benchmarkService.getCategories();
  }
}
