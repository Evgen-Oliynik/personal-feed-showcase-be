import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Res,
  StandardSchemaValidationPipe,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatService, type ChatAnswer } from '../ai/chat.service.js';
import {
  InvalidTopicError,
  TooManyTopicsError,
} from '../feed/feed-composer.js';
import { chatSchema, type ChatDto } from './chat.schema.js';

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

@Controller('chat')
@UsePipes(new StandardSchemaValidationPipe())
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  @Post()
  async ask(
    @Body({ schema: chatSchema }) body: ChatDto,
    @Res() res: Response,
  ): Promise<void> {
    let answer: ChatAnswer;
    try {
      answer = await this.chat.answer(body.question, body.topics, body.history);
    } catch (err) {
      if (err instanceof InvalidTopicError || err instanceof TooManyTopicsError)
        throw new BadRequestException(err.message);
      this.logger.warn(`chat failed: ${String(err)}`);
      this.begin(res);
      send(res, 'error', { message: 'The answer could not be completed' });
      res.end();
      return;
    }
    this.begin(res);
    try {
      send(res, 'sources', answer.sources);
      for await (const text of answer.tokens) send(res, 'delta', { text });
      send(res, 'done', {});
    } catch (err) {
      this.logger.warn(`chat failed: ${String(err)}`);
      send(res, 'error', { message: 'The answer could not be completed' });
    }
    res.end();
  }

  private begin(res: Response): void {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
  }
}
