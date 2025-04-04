import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  console.log(`Application is running on port ${port} in ${configService.environment} mode`);
}
bootstrap();
