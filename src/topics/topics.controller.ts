import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  StandardSchemaValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { TopicsService } from './topics.service.js';
import {
  createTopicSchema,
  topicIdSchema,
  type CreateTopicDto,
  type TopicDto,
} from './topics.schema.js';

@Controller('topics')
@UsePipes(new StandardSchemaValidationPipe())
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get()
  list(): TopicDto[] {
    return this.topics.list();
  }

  @Get('suggestions')
  suggestions(): string[] {
    return this.topics.suggestions();
  }

  @Post()
  create(@Body({ schema: createTopicSchema }) body: CreateTopicDto): TopicDto {
    return this.topics.create(body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', { schema: topicIdSchema }) id: number): void {
    this.topics.remove(id);
  }
}
