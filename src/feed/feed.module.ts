import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AiModule } from '../ai/ai.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { FeedBuilder } from './feed-builder.js';
import { FeedComposer } from './feed-composer.js';
import { TopicPool } from './topic-pool.js';
import { FeedController } from './feed.controller.js';
import { FeedScheduler } from './feed.scheduler.js';
import { FeedService } from './feed.service.js';

@Module({
  imports: [AiModule, SourcesModule, ScheduleModule.forRoot()],
  controllers: [FeedController],
  providers: [FeedBuilder, TopicPool, FeedComposer, FeedService, FeedScheduler],
  exports: [FeedBuilder, TopicPool, FeedComposer],
})
export class FeedModule {}
