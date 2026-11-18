import { Inject, Injectable } from '@nestjs/common';
import { and, between, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '../db/database.js';
import { DB } from '../db/db.module.js';
import {
  MEDIA_TYPES,
  mediaItems,
  topicItems,
  topicRequests,
} from '../db/schema.js';
import { createTopicSchema, MAX_TOPICS } from '../topics/topics.schema.js';
import {
  normalizeTitle,
  PER_TYPE_CAP,
  type MediaItemRow,
} from './feed-builder.js';
import { TopicPool } from './topic-pool.js';

export class InvalidTopicError extends Error {
  constructor(readonly name_: string) {
    super(`Invalid topic name: "${name_}"`);
    this.name = 'InvalidTopicError';
  }
}

export class TooManyTopicsError extends Error {
  constructor() {
    super(`At most ${MAX_TOPICS} topics are allowed`);
    this.name = 'TooManyTopicsError';
  }
}

/** A selected item; `topic` is the first of the requested topics whose pool holds it. */
export interface ComposedItem extends MediaItemRow {
  position: number;
}

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Builds a visitor's feed from the shared topic pools, depending only on the topic list and date. */
@Injectable()
export class FeedComposer {
  constructor(
    @Inject(DB) private readonly db: AppDb,
    private readonly pool: TopicPool,
  ) {}

  async compose(topics: string[], date: string): Promise<ComposedItem[]> {
    const names = this.normalize(topics);
    await Promise.all(names.map((t) => this.pool.ensure(t, date)));
    for (const topic of names)
      this.db
        .insert(topicRequests)
        .values({ topic, lastRequestedDate: date })
        .onConflictDoUpdate({
          target: topicRequests.topic,
          set: { lastRequestedDate: date },
        })
        .run();
    if (names.length === 0) return [];

    const rows = this.db
      .select({ item: mediaItems, topic: topicItems.topic })
      .from(topicItems)
      .innerJoin(mediaItems, eq(mediaItems.id, topicItems.mediaItemId))
      .where(
        and(
          inArray(topicItems.topic, names),
          between(topicItems.fetchDate, shiftDate(date, -2), date),
        ),
      )
      .all();

    // Each item belongs to the first requested topic whose pool holds it.
    const owner = new Map<number, { item: MediaItemRow; rank: number }>();
    for (const { item, topic } of rows) {
      const rank = names.indexOf(topic);
      const cur = owner.get(item.id);
      if (!cur || rank < cur.rank) owner.set(item.id, { item, rank });
    }
    const fillDays = new Set([shiftDate(date, -1), shiftDate(date, -2)]);
    const ofTopic = (rank: number, keep: (i: MediaItemRow) => boolean) =>
      [...owner.values()]
        .filter((o) => o.rank === rank && keep(o.item))
        .map((o) => ({ ...o.item, topic: names[rank]! }))
        .sort(
          (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id - b.id,
        );

    const perType = MEDIA_TYPES.map((type) => {
      const picked: MediaItemRow[] = [];
      const ids = new Set<number>();
      const titles = new Set<string>();
      const take = (keep: (i: MediaItemRow) => boolean) => {
        const groups = names.map((_, rank) =>
          ofTopic(rank, (i) => i.type === type && keep(i)),
        );
        for (let i = 0; picked.length < PER_TYPE_CAP; i++) {
          let any = false;
          for (const g of groups) {
            const item = g[i];
            if (!item) continue;
            any = true;
            const title = normalizeTitle(item.title);
            if (ids.has(item.id) || (title && titles.has(title))) continue;
            ids.add(item.id);
            if (title) titles.add(title);
            picked.push(item);
            if (picked.length === PER_TYPE_CAP) break;
          }
          if (!any) break;
        }
      };
      take((i) => i.firstSeenDate === date);
      if (picked.length < PER_TYPE_CAP)
        take((i) => fillDays.has(i.firstSeenDate));
      return picked;
    });

    const order: { item: MediaItemRow; rank: number; typeIdx: number }[] = [];
    perType.forEach((list, typeIdx) =>
      list.forEach((item, rank) => order.push({ item, rank, typeIdx })),
    );
    order.sort((a, b) => a.rank - b.rank || a.typeIdx - b.typeIdx);
    return order.map((o, position) => ({ ...o.item, position }));
  }

  private normalize(topics: string[]): string[] {
    const names: string[] = [];
    for (const raw of topics) {
      const parsed = createTopicSchema.shape.name.safeParse(raw);
      if (!parsed.success) throw new InvalidTopicError(String(raw));
      if (!names.includes(parsed.data)) names.push(parsed.data);
    }
    if (names.length > MAX_TOPICS) throw new TooManyTopicsError();
    return names;
  }
}
