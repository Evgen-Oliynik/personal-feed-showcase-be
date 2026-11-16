import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { DbModule } from './db/db.module.js';
import { FeedModule } from './feed/feed.module.js';
import { SourcesModule } from './sources/sources.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [AppConfigModule, DbModule, SourcesModule, TopicsModule, FeedModule],
  controllers: [HealthController],
})
export class AppModule {}
