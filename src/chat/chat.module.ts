import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { ChatService } from '../ai/chat.service.js';
import { FeedModule } from '../feed/feed.module.js';
import { ChatController } from './chat.controller.js';

@Module({
  imports: [AiModule, FeedModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
