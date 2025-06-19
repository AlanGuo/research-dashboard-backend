import "tsconfig-paths/register";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ConfigService } from "./config";
import { LogLevel } from "@nestjs/common";
import configuration from "./config/configuration";

async function bootstrap() {
  // 直接从配置文件加载日志级别
  const config = configuration();
  const loggingLevel = config.logging?.level || [
    "log",
    "error",
    "warn",
    "fatal",
    "debug",
    "verbose",
  ];

  const app = await NestFactory.create(AppModule, {
    logger: loggingLevel as LogLevel[],
  });
  const configService = app.get(ConfigService);
  // Enable CORS if configured
  if (configService.corsEnabled) {
    app.enableCors({
      origin: configService.corsOrigin,
    });
  }

  // Get port from config
  const port = configService.appPort || 3000;
  await app.listen(port);
  console.log(
    `Application is running on port ${port} in ${configService.environment} mode`,
  );
}
bootstrap();
