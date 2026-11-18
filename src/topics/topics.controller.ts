import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  StandardSchemaValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { FeedBuilder } from '../feed/feed-builder.js';
import { localDate } from '../feed/feed.service.js';
import { TopicsService } from './topics.service.js';
import {
  createTopicSchema,
  replaceTopicsSchema,
  topicIdSchema,
  type CreateTopicDto,
  type ReplaceTopicsDto,
  type TopicDto,
} from './topics.schema.js';

@Controller('topics')
@UsePipes(new StandardSchemaValidationPipe())
export class TopicsController {
  constructor(
    private readonly topics: TopicsService,
    private readonly feed: FeedBuilder,
  ) {}

  @Get()
  list(): TopicDto[] {
    return this.topics.list();
  }

  @Get('suggestions')
  suggestions(): string[] {
    return this.topics.suggestions();
  }

  @Post()
  async create(
    @Body({ schema: createTopicSchema }) body: CreateTopicDto,
  ): Promise<TopicDto> {
    const topic = this.topics.create(body.name);
    await this.feed.reselect(localDate());
    return topic;
  }

  @Put()
  async replace(
    @Body({ schema: replaceTopicsSchema }) body: ReplaceTopicsDto,
  ): Promise<TopicDto[]> {
    const list = this.topics.replace(body.names);
    await this.feed.reselect(localDate());
    return list;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', { schema: topicIdSchema }) id: number,
  ): Promise<void> {
    this.topics.remove(id);
    await this.feed.reselect(localDate());
  }
}
