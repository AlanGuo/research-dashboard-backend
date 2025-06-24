import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "../config";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    try {
      // 动态导入redis模块
      // 如果redis包未安装，请运行: npm install redis @types/redis
      const redis = await import("redis");
      const redisUrl =
        this.configService.get<string>("redis.url") || "redis://localhost:6379";

      this.client = redis.createClient({
        url: redisUrl,
      });

      this.client.on("error", (error: any) => {
        this.logger.error("Redis client error:", error);
      });

      this.client.on("connect", () => {
        this.logger.log("Redis client connected");
      });

      this.client.on("disconnect", () => {
        this.logger.warn("Redis client disconnected");
      });

      await this.client.connect();
      this.logger.log("Redis connection established");
    } catch (error) {
      this.logger.error("Failed to connect to Redis:", error);
      this.logger.error("请确保已安装redis包: npm install redis @types/redis");
      throw error;
    }
  }

  private async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.logger.log("Redis connection closed");
      }
    } catch (error) {
      this.logger.error("Error disconnecting from Redis:", error);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      if (!this.client) {
        throw new Error("Redis client is not connected");
      }
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(`Error getting key ${key} from Redis:`, error);
      throw error;
    }
  }

  /**
   * Parse TradingView cookie to extract session and signature
   * @param cookie Cookie string from Redis
   * @returns Object with session and signature
   */
  parseTradingViewCookie(cookie: string): {
    session: string;
    signature: string;
  } {
    const args = /sessionid=(.*?);sessionid_sign=(.*?);?$/.exec(cookie);
    if (!args || args.length < 3) {
      throw new Error("Invalid TradingView cookie format");
    }
    return {
      session: args[1],
      signature: args[2],
    };
  }
}
