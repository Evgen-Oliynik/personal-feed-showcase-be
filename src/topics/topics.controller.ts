import { Controller, Get } from '@nestjs/common';
import { TOPIC_SUGGESTIONS } from './topics.schema.js';

@Controller('topics')
export class TopicsController {
  @Get('suggestions')
  suggestions(): string[] {
    return [...TOPIC_SUGGESTIONS];
  }
}
