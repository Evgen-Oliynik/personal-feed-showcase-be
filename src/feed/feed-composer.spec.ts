import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DbHandle } from '../db/database.js';
import {
  mediaItems,
  topicFetches,
  topicItems,
  topicRequests,
} from '../db/schema.js';
import {
  FeedComposer,
  InvalidTopicError,
  TooManyTopicsError,
} from './feed-composer.js';
import type { TopicPool } from './topic-pool.js';

const DATE = '2026-03-10';

describe('FeedComposer', () => {
  let h: DbHandle;
  const ensure = vi.fn(async (_t: string, _d: string) => {});
  let n = 0;
  beforeEach(() => {
    h = openDatabase(':memory:');
    ensure.mockClear();
    n = 0;
  });
  afterEach(() => h.sqlite.close());

  const composer = () =>
    new FeedComposer(h.db, { ensure } as unknown as TopicPool);

  /** Seeds an item into the pool of `topic` (pool date = DATE). */
  const seed = (
    topic: string,
    o: {
      type?: 'read' | 'watch' | 'listen';
      seen?: string;
      published?: number;
      title?: string;
      url?: string;
    } = {},
  ) => {
    n++;
    const url = o.url ?? `https://x.test/${n}`;
    const row =
      h.db.select().from(mediaItems).where(eq(mediaItems.url, url)).get() ??
      h.db
        .insert(mediaItems)
        .values({
          url,
          type: o.type ?? 'read',
          source: 'devto',
          topic,
          title: o.title ?? `title ${n}`,
          summary: 's',
          publishedAt: new Date(
            Date.UTC(2026, 0, 1, 0, o.published ?? n),
          ).toISOString(),
          fetchedAt: '2026-03-10T00:00:00.000Z',
          firstSeenDate: o.seen ?? DATE,
        })
        .returning()
        .get();
    h.db
      .insert(topicFetches)
      .values({ topic, fetchDate: DATE, source: 'devto' })
      .onConflictDoNothing()
      .run();
    h.db
      .insert(topicItems)
      .values({ topic, fetchDate: DATE, mediaItemId: row.id })
      .run();
    return row;
  };

  it('caps each type at 10 and interleaves types', async () => {
    for (let i = 0; i < 14; i++) seed('a', { type: 'read' });
    for (let i = 0; i < 3; i++) seed('a', { type: 'watch' });
    seed('a', { type: 'listen' });
    const out = await composer().compose(['a'], DATE);
    expect(out.filter((i) => i.type === 'read')).toHaveLength(10);
    expect(out).toHaveLength(14);
    expect(out.map((i) => i.type).slice(0, 4)).toEqual([
      'read',
      'watch',
      'listen',
      'read',
    ]);
    expect(out.map((i) => i.position)).toEqual(out.map((_, i) => i));
  });

  it('round-robins across 3 topics in the given order, newest first', async () => {
    const a1 = seed('a', { published: 10 });
    const a2 = seed('a', { published: 20 });
    const b1 = seed('b', { published: 5 });
    const c1 = seed('c', { published: 1 });
    const c2 = seed('c', { published: 2 });
    const out = await composer().compose(['b', 'a', 'c'], DATE);
    expect(out.map((i) => i.id)).toEqual([b1.id, a2.id, c2.id, a1.id, c1.id]);
    expect(out.map((i) => i.topic)).toEqual(['b', 'a', 'c', 'a', 'c']);
  });

  it('fills with date-1 and date-2 items only after fresh ones', async () => {
    const fresh = seed('a', { seen: DATE, published: 1 });
    const y = seed('a', { seen: '2026-03-09', published: 100 });
    const d2 = seed('a', { seen: '2026-03-08', published: 50 });
    seed('a', { seen: '2026-03-07', published: 200 });
    const out = await composer().compose(['a'], DATE);
    expect(out.map((i) => i.id)).toEqual([fresh.id, y.id, d2.id]);
  });

  it('does not fill when there are already 10 fresh items', async () => {
    for (let i = 0; i < 10; i++) seed('a');
    seed('a', { seen: '2026-03-09' });
    const out = await composer().compose(['a'], DATE);
    expect(out).toHaveLength(10);
    expect(out.every((i) => i.firstSeenDate === DATE)).toBe(true);
  });

  it('never repeats an item or a normalized title; topic is the first holding it', async () => {
    const shared = seed('a', { url: 'https://x.test/shared' });
    seed('b', { url: 'https://x.test/shared' });
    seed('a', { title: 'Hello, World!' });
    seed('b', { title: 'hello world' });
    const out = await composer().compose(['b', 'a'], DATE);
    expect(new Set(out.map((i) => i.id)).size).toBe(out.length);
    expect(out).toHaveLength(2);
    expect(out.find((i) => i.id === shared.id)!.topic).toBe('b');
    expect(
      out.filter((i) => normalizeTitleOf(i.title) === 'hello world'),
    ).toHaveLength(1);
  });

  it('is deterministic', async () => {
    for (const t of ['a', 'b', 'c'])
      for (let i = 0; i < 6; i++)
        seed(t, {
          type: (['read', 'watch', 'listen'] as const)[i % 3],
          published: 7,
        });
    const c = composer();
    const first = await c.compose(['c', 'a', 'b'], DATE);
    const second = await c.compose(['c', 'a', 'b'], DATE);
    expect(second).toEqual(first);
  });

  it('composes two different topic lists independently', async () => {
    const a = seed('a');
    const b = seed('b');
    const c = composer();
    expect((await c.compose(['a'], DATE)).map((i) => i.id)).toEqual([a.id]);
    expect((await c.compose(['b'], DATE)).map((i) => i.id)).toEqual([b.id]);
  });

  it('ensures every topic and records the request date', async () => {
    seed('a');
    await composer().compose(['a', 'b'], DATE);
    expect(ensure.mock.calls).toEqual([
      ['a', DATE],
      ['b', DATE],
    ]);
    const reqs = h.db.select().from(topicRequests).all();
    expect(
      reqs
        .map((r) => [r.topic, r.lastRequestedDate])
        .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    ).toEqual([
      ['a', DATE],
      ['b', DATE],
    ]);
  });

  it('normalizes names and merges duplicates keeping the first', async () => {
    const a = seed('a');
    const b = seed('b');
    const out = await composer().compose([' A ', 'b', 'a'], DATE);
    expect(out.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid names', async () => {
    for (const bad of ['', '  ', '-x', 'a!', 'x'.repeat(41)])
      await expect(composer().compose([bad], DATE)).rejects.toBeInstanceOf(
        InvalidTopicError,
      );
  });

  it('rejects more than 10 topics but accepts 10', async () => {
    const names = Array.from({ length: 11 }, (_, i) => `t${i}`);
    await expect(composer().compose(names, DATE)).rejects.toBeInstanceOf(
      TooManyTopicsError,
    );
    await expect(
      composer().compose([...names.slice(0, 10), 't0'], DATE),
    ).resolves.toEqual([]);
  });
});

const normalizeTitleOf = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
