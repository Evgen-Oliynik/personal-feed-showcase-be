import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import { EMBEDDER, FakeEmbedder, LocalEmbedder } from './embedder.js';
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
    ItemEmbeddings,
    { provide: ITEM_EMBEDDINGS, useExisting: ItemEmbeddings },
  ],
  exports: [EMBEDDER, ITEM_EMBEDDINGS],
})
export class AiModule {}
