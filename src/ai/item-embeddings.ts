import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DbHandle } from '../db/database.js';
import { DB_HANDLE } from '../db/db.module.js';
import { EMBEDDER, type Embedder } from './embedder.js';

export interface EmbeddableItem {
  id: number;
  title: string;
  summary: string;
  content: string | null;
}

export const ITEM_EMBEDDINGS = Symbol('ITEM_EMBEDDINGS');

/** Stores one embedding per media item in `item_embeddings`. */
export interface ItemEmbeddingStore {
  embedMissing(items: EmbeddableItem[]): Promise<void>;
}

@Injectable()
export class ItemEmbeddings implements ItemEmbeddingStore {
  private readonly logger = new Logger(ItemEmbeddings.name);

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
  ) {}

  /** Embeds the items that have no vector yet. A failure is logged, never thrown. */
  async embedMissing(items: EmbeddableItem[]): Promise<void> {
    try {
      const { sqlite } = this.handle;
      const has = sqlite.prepare(
        'SELECT 1 FROM item_embeddings WHERE media_item_id = ?',
      );
      const todo = items.filter((i) => !has.get(BigInt(i.id)));
      if (todo.length === 0) return;

      const vectors = await this.embedder.embed(
        todo.map((i) => `${i.title}\n${i.content ?? i.summary}`),
      );
      const insert = sqlite.prepare(
        'INSERT INTO item_embeddings(media_item_id, embedding) VALUES (?, ?)',
      );
      sqlite.transaction(() => {
        todo.forEach((item, idx) =>
          insert.run(BigInt(item.id), new Float32Array(vectors[idx]!)),
        );
      })();
    } catch (err) {
      this.logger.warn(
        `embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
