import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  ITEM_EMBEDDINGS,
  type ItemEmbeddingStore,
} from '../ai/item-embeddings.js';
import type { AppDb } from '../db/database.js';
import { DB } from '../db/db.module.js';
import { mediaItems, topicFetches, topicItems } from '../db/schema.js';
import { classify } from '../sources/classify.js';
import type { MediaSource, RawMediaItem } from '../sources/media-source.js';
import { SOURCES } from '../sources/sources.module.js';
import {
  normalizeTitle,
  PER_SOURCE_LIMIT,
  type MediaItemRow,
} from './feed-builder.js';

/** The server's local date of an ISO timestamp, as YYYY-MM-DD. */
const localDay = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Per-topic daily cache of fetched items, shared by every visitor's feed. */
@Injectable()
export class TopicPool {
  private readonly logger = new Logger(TopicPool.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    @Inject(DB) private readonly db: AppDb,
    @Inject(ITEM_EMBEDDINGS) private readonly embeddings: ItemEmbeddingStore,
    @Inject(SOURCES) private readonly sources: MediaSource[],
  ) {}

  /** Fetches `topic` for `date` unless that was already done; concurrent calls share one fetch. */
  ensure(topic: string, date: string): Promise<void> {
    const key = JSON.stringify([topic, date]);
    const running = this.inFlight.get(key);
    if (running) return running;
    const run = this.doEnsure(topic, date).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, run);
    return run;
  }

  private async doEnsure(topic: string, date: string): Promise<void> {
    const done = this.db
      .select()
      .from(topicFetches)
      .where(
        and(eq(topicFetches.topic, topic), eq(topicFetches.fetchDate, date)),
      )
      .get();
    if (done) return;

    const fetched = await this.fetchAll(topic);
    const inserted: MediaItemRow[] = [];

    this.db.transaction((tx) => {
      const fetchedAt = new Date().toISOString();
      const pool = new Set(
        tx
          .select({ title: mediaItems.title })
          .from(topicItems)
          .innerJoin(mediaItems, eq(mediaItems.id, topicItems.mediaItemId))
          .where(
            and(eq(topicItems.topic, topic), eq(topicItems.fetchDate, date)),
          )
          .all()
          .map((r) => normalizeTitle(r.title))
          .filter(Boolean),
      );
      const seenUrls = new Set<string>();
      for (const item of fetched) {
        if (seenUrls.has(item.url)) continue;
        const title = normalizeTitle(item.title);
        if (title && pool.has(title)) continue;
        seenUrls.add(item.url);
        if (title) pool.add(title);

        let row = tx
          .select()
          .from(mediaItems)
          .where(eq(mediaItems.url, item.url))
          .get();
        if (!row) {
          row = tx
            .insert(mediaItems)
            .values({
              url: item.url,
              type: classify(item),
              source: item.source,
              topic,
              title: item.title,
              summary: item.summary,
              content: item.content ?? null,
              author: item.author ?? null,
              imageUrl: item.imageUrl ?? null,
              publishedAt: item.publishedAt,
              durationSec: item.durationSec ?? null,
              fetchedAt,
              firstSeenDate: localDay(fetchedAt),
            })
            .returning()
            .get();
          inserted.push(row);
        }
        tx.insert(topicItems)
          .values({ topic, fetchDate: date, mediaItemId: row.id })
          .onConflictDoNothing()
          .run();
      }
      tx.insert(topicFetches)
        .values({ topic, fetchDate: date })
        .onConflictDoNothing()
        .run();
    });

    await this.embeddings.embedMissing(inserted); // never throws
  }

  private async fetchAll(topic: string): Promise<RawMediaItem[]> {
    const jobs = this.sources
      .filter((s) => s.enabled())
      .map(async (source) => {
        try {
          return await source.fetch(topic, PER_SOURCE_LIMIT);
        } catch (err) {
          this.logger.warn(
            `${source.id} failed for "${topic}": ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }
      });
    return (await Promise.all(jobs)).flat();
  }
}
