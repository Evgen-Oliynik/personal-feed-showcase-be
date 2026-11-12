import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [AppConfigModule, DbModule],
  controllers: [HealthController],
})
export class AppModule {}
