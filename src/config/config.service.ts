import { Injectable, LogLevel } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
  constructor(private configService: NestConfigService) {}

  get<T>(key: string): T {
    return this.configService.get<T>(key);
  }

  // Helper methods for common config values
  get appName(): string {
    return this.configService.get<string>('app.name');
  }

  get appPort(): number {
    return this.configService.get<number>('app.port');
  }

  get environment(): string {
    return this.configService.get<string>('app.environment');
  }

  get databaseConfig(): any {
    return this.configService.get('database');
  }

  get loggingLevel(): LogLevel[] {
    return this.configService.get<LogLevel[]>('logging.level');
  }

  get corsEnabled(): boolean {
    return this.configService.get<boolean>('cors.enabled');
  }

  get corsOrigin(): string {
    return this.configService.get<string>('cors.origin');
  }

  get notionApiKey(): string {
    return this.configService.get<string>('notion.api_key');
  }

  get binanceApiUrl(): string {
    return this.configService.get<string>('binance.api_url');
  }

  get binanceRequestDelay(): number {
    return this.configService.get<number>('binance.request_delay');
  }

  get binanceFuturesApiUrl(): string {
    return this.configService.get<string>('binance.futures_api_url');
  }

  getNotionDatabaseId(user: string, databaseType: string): string {
    return this.configService.get<string>(
      `notion.user.${user}.${databaseType}`,
    );
  }
}
