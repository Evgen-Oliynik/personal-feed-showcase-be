import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { DbModule } from './db/db.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [AppConfigModule, DbModule, TopicsModule],
  controllers: [HealthController],
})
export class AppModule {}
