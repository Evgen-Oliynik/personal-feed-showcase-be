import { Controller, Get, Query } from '@nestjs/common';
import { FeedService, type FeedDto } from './feed.service.js';

@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('today')
  today(@Query('topics') topics?: string | string[]): Promise<FeedDto> {
    const raw = Array.isArray(topics) ? topics.join(',') : (topics ?? '');
    return this.feed.today(raw.trim() === '' ? [] : raw.split(','));
  }
}
