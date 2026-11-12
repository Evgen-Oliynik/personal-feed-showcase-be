import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  app.enableCors({ origin: config.get('FRONTEND_ORIGIN') });
  await app.listen(config.get('PORT'));
}
await bootstrap();
