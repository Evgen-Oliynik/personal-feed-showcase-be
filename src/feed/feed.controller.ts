import { Controller, Get } from '@nestjs/common';
import { FeedService, type FeedDto } from './feed.service.js';

@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('today')
  today(): Promise<FeedDto> {
    return this.feed.today();
  }
}
