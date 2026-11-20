import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DbHandle } from '../db/database.js';
import { DB_HANDLE } from '../db/db.module.js';
import { chunkItem } from './chunks.js';
import { EMBEDDER, type Embedder } from './embedder.js';

export interface EmbeddableItem {
  id: number;
  title: string;
  summary: string;
  content: string | null;
}

export const ITEM_EMBEDDINGS = Symbol('ITEM_EMBEDDINGS');

/** Stores chunks and their embeddings for each media item. */
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

  /**
   * Chunks and embeds the items that have no chunks yet, storing chunks and
   * vectors in one transaction. A failure is logged, never thrown.
   */
  async embedMissing(items: EmbeddableItem[]): Promise<void> {
    try {
      const { sqlite } = this.handle;
      const has = sqlite.prepare(
        'SELECT 1 FROM item_chunks WHERE media_item_id = ?',
      );
      const todo = items.filter((i) => !has.get(BigInt(i.id)));
      if (todo.length === 0) return;

      const pieces = todo.flatMap((item) =>
        chunkItem(item).map((text, idx) => ({ item, idx, text })),
      );
      const vectors = await this.embedder.embed(
        pieces.map((p) => `${p.item.title}\n${p.text}`),
        'passage',
      );
      const insertChunk = sqlite.prepare(
        'INSERT INTO item_chunks(media_item_id, idx, text) VALUES (?, ?, ?)',
      );
      const insertVec = sqlite.prepare(
        'INSERT INTO chunk_embeddings(chunk_id, embedding) VALUES (?, ?)',
      );
      const insertFts = sqlite.prepare(
        'INSERT INTO chunk_fts(rowid, text) VALUES (?, ?)',
      );
      sqlite.transaction(() => {
        pieces.forEach((p, i) => {
          const { lastInsertRowid } = insertChunk.run(
            BigInt(p.item.id),
            p.idx,
            p.text,
          );
          insertVec.run(BigInt(lastInsertRowid), new Float32Array(vectors[i]!));
          insertFts.run(BigInt(lastInsertRowid), p.text);
        });
      })();
    } catch (err) {
      this.logger.warn(
        `embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
