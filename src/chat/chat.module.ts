import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { ChatController } from './chat.controller.js';

@Module({ imports: [AiModule], controllers: [ChatController] })
export class ChatModule {}
