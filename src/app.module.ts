import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [AppConfigModule],
  controllers: [HealthController],
})
export class AppModule {}
