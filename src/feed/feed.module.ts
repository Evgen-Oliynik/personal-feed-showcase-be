import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AiModule } from '../ai/ai.module.js';
import { SourcesModule } from '../sources/sources.module.js';
import { FeedBuilder } from './feed-builder.js';
import { FeedController } from './feed.controller.js';
import { FeedScheduler } from './feed.scheduler.js';
import { FeedService } from './feed.service.js';

@Module({
  imports: [AiModule, SourcesModule, ScheduleModule.forRoot()],
  controllers: [FeedController],
  providers: [FeedBuilder, FeedService, FeedScheduler],
  exports: [FeedBuilder],
})
export class FeedModule {}
