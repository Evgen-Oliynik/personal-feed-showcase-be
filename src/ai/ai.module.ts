import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import { EMBEDDER, FakeEmbedder, LocalEmbedder } from './embedder.js';
import { ChatService } from './chat.service.js';
import { OpenAiLlm, FakeLlm, LLM } from './llm.js';
import { ItemEmbeddings, ITEM_EMBEDDINGS } from './item-embeddings.js';

@Module({
  providers: [
    {
      provide: EMBEDDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        config.get('FAKE_EXTERNALS', { infer: true })
          ? new FakeEmbedder()
          : new LocalEmbedder(config.get('EMBEDDING_MODEL', { infer: true })),
    },
    {
      provide: LLM,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        config.get('FAKE_EXTERNALS', { infer: true })
          ? new FakeLlm()
          : new OpenAiLlm({
              apiKey: config.get('OPENAI_API_KEY', { infer: true }),
              model: config.get('OPENAI_MODEL', { infer: true }),
              maxTokens: config.get('OPENAI_MAX_TOKENS', { infer: true }),
            }),
    },
    ChatService,
    ItemEmbeddings,
    { provide: ITEM_EMBEDDINGS, useExisting: ItemEmbeddings },
  ],
  exports: [ChatService, LLM, EMBEDDER, ITEM_EMBEDDINGS],
})
export class AiModule {}
