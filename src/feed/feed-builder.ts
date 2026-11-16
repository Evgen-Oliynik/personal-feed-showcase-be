import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import {
  ITEM_EMBEDDINGS,
  type ItemEmbeddingStore,
} from '../ai/item-embeddings.js';
import type { AppDb } from '../db/database.js';
import { DB } from '../db/db.module.js';
import {
  feedEntries,
  feeds,
  mediaItems,
  topics,
  MEDIA_TYPES,
} from '../db/schema.js';
import { classify } from '../sources/classify.js';
import type { MediaSource, RawMediaItem } from '../sources/media-source.js';
import { SOURCES } from '../sources/sources.module.js';

export const PER_SOURCE_LIMIT = 15;
export const PER_TYPE_CAP = 10;

/** Lowercased, punctuation and emoji removed, whitespace collapsed. */
export const normalizeTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

export type MediaItemRow = typeof mediaItems.$inferSelect;

export interface Feed {
  date: string;
  builtAt: string | null;
  /** In All-tab order. */
  items: MediaItemRow[];
}

@Injectable()
export class FeedBuilder {
  private readonly logger = new Logger(FeedBuilder.name);
  private retrying = false;

  constructor(
    @Inject(DB) private readonly db: AppDb,
    @Inject(ITEM_EMBEDDINGS) private readonly embeddings: ItemEmbeddingStore,
    @Inject(SOURCES) private readonly sources: MediaSource[],
  ) {}

  async build(date: string): Promise<Feed> {
    const stored = this.db
      .select()
      .from(feeds)
      .where(eq(feeds.feedDate, date))
      .get();
    if (stored) {
      const feed = this.load(date, stored.builtAt);
      this.retryMissingEmbeddings(feed.items);
      return feed;
    }

    const topicRows = this.db
      .select()
      .from(topics)
      .orderBy(asc(topics.createdAt), asc(topics.id))
      .all();
    if (topicRows.length === 0) return { date, builtAt: null, items: [] };

    const fetched = await this.fetchAll(topicRows.map((t) => t.name));

    this.db.transaction((tx) => {
      // Re-check inside the transaction: a concurrent build may have finished first.
      if (tx.select().from(feeds).where(eq(feeds.feedDate, date)).get()) return;

      const fetchedAt = new Date().toISOString();
      const seen = new Set<string>();
      // Titles already shown on earlier days.
      const seenTitles = new Set(
        tx
          .select({ title: mediaItems.title })
          .from(feedEntries)
          .innerJoin(mediaItems, eq(mediaItems.id, feedEntries.mediaItemId))
          .all()
          .map((e) => normalizeTitle(e.title))
          .filter(Boolean),
      );
      const rows: MediaItemRow[] = [];
      for (const { topic, item } of fetched) {
        if (seen.has(item.url)) continue; // the first topic wins
        const title = normalizeTitle(item.title);
        if (title && seenTitles.has(title)) continue; // cross-posted: first in source order wins
        seen.add(item.url);
        if (title) seenTitles.add(title);
        tx.insert(mediaItems)
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
          })
          .onConflictDoNothing()
          .run();
        rows.push(
          tx
            .select()
            .from(mediaItems)
            .where(eq(mediaItems.url, item.url))
            .get()!,
        );
      }

      const used = new Set(
        tx
          .select({ id: feedEntries.mediaItemId })
          .from(feedEntries)
          .all()
          .map((e) => e.id),
      );
      const topicOrder = topicRows.map((t) => t.name);
      const ranked = MEDIA_TYPES.map((type) =>
        this.select(
          rows.filter((r) => r.type === type && !used.has(r.id)),
          topicOrder,
        ),
      );

      const order: { item: MediaItemRow; rank: number; typeIdx: number }[] = [];
      ranked.forEach((list, typeIdx) =>
        list.forEach((item, rank) => order.push({ item, rank, typeIdx })),
      );
      order.sort((a, b) => a.rank - b.rank || a.typeIdx - b.typeIdx);

      order.forEach(({ item }, position) =>
        tx
          .insert(feedEntries)
          .values({ feedDate: date, mediaItemId: item.id, position })
          .run(),
      );
      tx.insert(feeds)
        .values({ feedDate: date, builtAt: new Date().toISOString() })
        .run();
    });

    const row = this.db
      .select()
      .from(feeds)
      .where(eq(feeds.feedDate, date))
      .get()!;
    const feed = this.load(date, row.builtAt);
    await this.embeddings.embedMissing(feed.items); // never throws
    return feed;
  }

  /** Fire-and-forget, one run at a time: a stored feed may hold items whose embedding failed earlier. */
  private retryMissingEmbeddings(items: MediaItemRow[]) {
    if (this.retrying) return;
    this.retrying = true;
    void Promise.resolve()
      .then(() => this.embeddings.embedMissing(items))
      .catch((err: unknown) =>
        this.logger.warn(
          `background embedding failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      .finally(() => {
        this.retrying = false;
      });
  }

  /** Round-robin across topics, newest first within a topic, up to the cap. */
  private select(candidates: MediaItemRow[], topicOrder: string[]) {
    const groups = topicOrder.map((name) =>
      candidates
        .filter((c) => c.topic === name)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    );
    const picked: MediaItemRow[] = [];
    for (let i = 0; picked.length < PER_TYPE_CAP; i++) {
      let any = false;
      for (const g of groups) {
        const item = g[i];
        if (!item) continue;
        any = true;
        picked.push(item);
        if (picked.length === PER_TYPE_CAP) break;
      }
      if (!any) break;
    }
    return picked;
  }

  private async fetchAll(topicNames: string[]) {
    const jobs = topicNames.flatMap((topic) =>
      this.sources.map(async (source) => {
        try {
          const items = await source.fetch(topic, PER_SOURCE_LIMIT);
          return items.map((item: RawMediaItem) => ({ topic, item }));
        } catch (err) {
          this.logger.warn(
            `${source.id} failed for "${topic}": ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }
      }),
    );
    return (await Promise.all(jobs)).flat();
  }

  private load(date: string, builtAt: string): Feed {
    const items = this.db
      .select({ item: mediaItems })
      .from(feedEntries)
      .innerJoin(mediaItems, eq(mediaItems.id, feedEntries.mediaItemId))
      .where(eq(feedEntries.feedDate, date))
      .orderBy(asc(feedEntries.position))
      .all()
      .map((r) => r.item);
    return { date, builtAt, items };
  }
}
