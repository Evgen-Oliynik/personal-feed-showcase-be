import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SourcesModule } from '../sources/sources.module.js';
import { FeedBuilder } from './feed-builder.js';
import { FeedController } from './feed.controller.js';
import { FeedScheduler } from './feed.scheduler.js';
import { FeedService } from './feed.service.js';

@Module({
  imports: [SourcesModule, ScheduleModule.forRoot()],
  controllers: [FeedController],
  providers: [FeedBuilder, FeedService, FeedScheduler],
  exports: [FeedBuilder],
})
export class FeedModule {}
