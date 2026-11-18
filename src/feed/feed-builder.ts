import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq, inArray, ne } from 'drizzle-orm';
import {
  ITEM_EMBEDDINGS,
  type ItemEmbeddingStore,
} from '../ai/item-embeddings.js';
import type { AppDb } from '../db/database.js';
import { DB } from '../db/db.module.js';
import {
  feedEntries,
  feedTopicFetches,
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

type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/** The server's local date of an ISO timestamp, as YYYY-MM-DD. */
const localDay = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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

  private readonly locks = new Map<string, Promise<unknown>>();

  /** One build or re-select at a time per date. */
  private exclusive<T>(date: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(date) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    this.locks.set(date, tail);
    void tail.then(() => {
      if (this.locks.get(date) === tail) this.locks.delete(date);
    });
    return run;
  }

  build(date: string): Promise<Feed> {
    return this.exclusive(date, () => this.doBuild(date));
  }

  /**
   * Adapts an already built feed to the current topics: drops entries of removed
   * topics, fetches added topics once per date and fills the freed slots.
   */
  reselect(date: string): Promise<void> {
    return this.exclusive(date, () => this.doReselect(date));
  }

  private async doReselect(date: string): Promise<void> {
    if (!this.db.select().from(feeds).where(eq(feeds.feedDate, date)).get())
      return;

    const topicOrder = this.db
      .select()
      .from(topics)
      .orderBy(asc(topics.createdAt), asc(topics.id))
      .all()
      .map((t) => t.name);
    const fetchedTopics = new Set(
      this.db
        .select({ topic: feedTopicFetches.topic })
        .from(feedTopicFetches)
        .where(eq(feedTopicFetches.feedDate, date))
        .all()
        .map((r) => r.topic),
    );
    const added = topicOrder.filter((t) => !fetchedTopics.has(t));
    const hasRemoved = this.load(date, '').items.some(
      (i) => !topicOrder.includes(i.topic),
    );
    if (added.length === 0 && !hasRemoved) return;

    const fetched = await this.fetchAll(added);
    const fresh: MediaItemRow[] = [];

    this.db.transaction((tx) => {
      const fetchedAt = new Date().toISOString();
      const kept = tx
        .select({ item: mediaItems })
        .from(feedEntries)
        .innerJoin(mediaItems, eq(mediaItems.id, feedEntries.mediaItemId))
        .where(eq(feedEntries.feedDate, date))
        .orderBy(asc(feedEntries.position))
        .all()
        .map((r) => r.item)
        .filter((i) => topicOrder.includes(i.topic));
      const earlier = tx
        .select({ id: mediaItems.id, title: mediaItems.title })
        .from(feedEntries)
        .innerJoin(mediaItems, eq(mediaItems.id, feedEntries.mediaItemId))
        .where(ne(feedEntries.feedDate, date))
        .all();
      const seenTitles = new Set(
        [...earlier, ...kept]
          .map((e) => normalizeTitle(e.title))
          .filter(Boolean),
      );
      const used = new Set([...earlier, ...kept].map((e) => e.id));

      const rows = this.upsertItems(tx, fetched, seenTitles, fetchedAt);
      const rowIds = new Set(rows.map((r) => r.id));
      // Items of current topics fetched earlier today that did not fit at build time.
      const leftovers = tx
        .select()
        .from(mediaItems)
        .where(inArray(mediaItems.topic, topicOrder))
        .all()
        .filter((m) => !rowIds.has(m.id) && localDay(m.fetchedAt) === date)
        .filter((m) => {
          const title = normalizeTitle(m.title);
          if (used.has(m.id) || (title && seenTitles.has(title))) return false;
          if (title) seenTitles.add(title);
          return true;
        });
      const candidates = [...rows, ...leftovers].filter((r) => !used.has(r.id));

      const order = this.interleave(
        MEDIA_TYPES.map((type) =>
          this.select(
            candidates.filter((r) => r.type === type),
            topicOrder,
            PER_TYPE_CAP - kept.filter((k) => k.type === type).length,
          ),
        ),
      );
      fresh.push(...order);

      tx.delete(feedEntries).where(eq(feedEntries.feedDate, date)).run();
      [...kept, ...order].forEach((item, position) =>
        tx
          .insert(feedEntries)
          .values({ feedDate: date, mediaItemId: item.id, position })
          .run(),
      );
      for (const topic of added)
        tx.insert(feedTopicFetches).values({ feedDate: date, topic }).run();
    });

    await this.embeddings.embedMissing(fresh); // never throws
  }

  private async doBuild(date: string): Promise<Feed> {
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
      const rows = this.upsertItems(tx, fetched, seenTitles, fetchedAt);

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

      const order = this.interleave(ranked);

      order.forEach((item, position) =>
        tx
          .insert(feedEntries)
          .values({ feedDate: date, mediaItemId: item.id, position })
          .run(),
      );
      for (const { name } of topicRows)
        tx.insert(feedTopicFetches)
          .values({ feedDate: date, topic: name })
          .run();
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

  /** Inserts the fetched items (first topic wins, title duplicates skipped) and returns their rows. */
  private upsertItems(
    tx: Tx,
    fetched: { topic: string; item: RawMediaItem }[],
    seenTitles: Set<string>,
    fetchedAt: string,
  ) {
    const seen = new Set<string>();
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
          firstSeenDate: localDay(fetchedAt),
        })
        .onConflictDoNothing()
        .run();
      rows.push(
        tx.select().from(mediaItems).where(eq(mediaItems.url, item.url)).get()!,
      );
    }
    return rows;
  }

  /** Interleaves per-type lists by rank, then by type. */
  private interleave(ranked: MediaItemRow[][]) {
    const order: { item: MediaItemRow; rank: number; typeIdx: number }[] = [];
    ranked.forEach((list, typeIdx) =>
      list.forEach((item, rank) => order.push({ item, rank, typeIdx })),
    );
    order.sort((a, b) => a.rank - b.rank || a.typeIdx - b.typeIdx);
    return order.map((o) => o.item);
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
  private select(
    candidates: MediaItemRow[],
    topicOrder: string[],
    cap = PER_TYPE_CAP,
  ) {
    const groups = topicOrder.map((name) =>
      candidates
        .filter((c) => c.topic === name)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    );
    const picked: MediaItemRow[] = [];
    for (let i = 0; picked.length < cap; i++) {
      let any = false;
      for (const g of groups) {
        const item = g[i];
        if (!item) continue;
        any = true;
        picked.push(item);
        if (picked.length === cap) break;
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
