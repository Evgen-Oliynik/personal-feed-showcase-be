import { Module } from '@nestjs/common';
import { FeedModule } from '../feed/feed.module.js';
import { TopicsController } from './topics.controller.js';
import { TopicsService } from './topics.service.js';

@Module({
  imports: [FeedModule],
  controllers: [TopicsController],
  providers: [TopicsService],
})
export class TopicsModule {}
