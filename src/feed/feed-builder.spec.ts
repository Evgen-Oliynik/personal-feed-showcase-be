import { ItemEmbeddings } from '../ai/item-embeddings.js';
import { eq } from 'drizzle-orm';
import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DbHandle } from '../db/database.js';
import { feedEntries, feedTopicFetches, feeds, topics } from '../db/schema.js';
import type { MediaSource, RawMediaItem } from '../sources/media-source.js';
import { FeedBuilder } from './feed-builder.js';

const noEmbeddings = { embedMissing: async () => {} };

let n = 0;
const raw = (
  source: RawMediaItem['source'],
  topic: string,
  publishedAt: string,
  url = `https://x.test/${source}/${topic}/${n++}`,
): RawMediaItem => ({
  url,
  title: `${topic} ${n}`,
  summary: 's',
  publishedAt,
  source,
});

const day = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();

/** devto -> read, youtube -> watch, itunes -> listen. */
function source(
  id: RawMediaItem['source'],
  make: (topic: string, limit: number) => RawMediaItem[],
): MediaSource {
  return { id, enabled: () => true, fetch: async (t, l) => make(t, l) };
}

describe('FeedBuilder', () => {
  let h: DbHandle;
  beforeEach(() => {
    h = openDatabase(':memory:');
  });
  afterEach(() => h.sqlite.close());

  const addTopics = (...names: string[]) => {
    names.forEach((name, i) =>
      h.db
        .insert(topics)
        .values({ name, createdAt: `2026-01-01T00:00:0${i}.000Z` })
        .run(),
    );
  };
  const typeCounts = (items: { type: string }[]) =>
    Object.fromEntries(
      ['read', 'watch', 'listen'].map((t) => [
        t,
        items.filter((i) => i.type === t).length,
      ]),
    );

  it('caps each type at 10', async () => {
    addTopics('a');
    const many = (id: RawMediaItem['source']) =>
      source(id, (t) =>
        Array.from({ length: 15 }, (_, i) => raw(id, t, day(i))),
      );
    const b = new FeedBuilder(h.db, noEmbeddings, [
      many('devto'),
      many('youtube'),
      many('itunes'),
    ]);
    const feed = await b.build('2026-01-01');
    expect(typeCounts(feed.items)).toEqual({ read: 10, watch: 10, listen: 10 });
  });

  it('round-robins across topics, newest first', async () => {
    addTopics('a', 'b', 'c');
    const counts: Record<string, number> = { a: 4, b: 2, c: 1 };
    const b = new FeedBuilder(h.db, noEmbeddings, [
      source('devto', (t) =>
        Array.from({ length: counts[t]! }, (_, i) => raw('devto', t, day(i))),
      ),
    ]);
    const feed = await b.build('2026-01-01');
    expect(feed.items.map((i) => i.topic)).toEqual([
      'a',
      'b',
      'c',
      'a',
      'b',
      'a',
      'a',
    ]);
    const a = feed.items
      .filter((i) => i.topic === 'a')
      .map((i) => i.publishedAt);
    expect(a).toEqual([...a].sort().reverse());
  });

  it('interleaves read/watch/listen by position within type', async () => {
    addTopics('a');
    const b = new FeedBuilder(h.db, noEmbeddings, [
      source('devto', (t) => [
        raw('devto', t, day(2)),
        raw('devto', t, day(1)),
      ]),
      source('youtube', (t) => [raw('youtube', t, day(1))]),
      source('itunes', (t) => [raw('itunes', t, day(1))]),
    ]);
    const feed = await b.build('2026-01-01');
    expect(feed.items.map((i) => i.type)).toEqual([
      'read',
      'watch',
      'listen',
      'read',
    ]);
    const pos = h.db
      .select()
      .from(feedEntries)
      .all()
      .map((e) => e.position);
    expect(pos.sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
  });

  it('excludes items from earlier days', async () => {
    addTopics('a');
    let batch = 0;
    const b = new FeedBuilder(h.db, noEmbeddings, [
      source('devto', (t) =>
        batch === 0
          ? [raw('devto', t, day(1), 'https://x.test/1')]
          : [
              raw('devto', t, day(1), 'https://x.test/1'),
              {
                ...raw('devto', t, day(0), 'https://x.test/2'),
                title: 'second',
              },
            ],
      ),
    ]);
    const d1 = await b.build('2026-01-01');
    batch = 1;
    const d2 = await b.build('2026-01-02');
    expect(d1.items.map((i) => i.url)).toEqual(['https://x.test/1']);
    expect(d2.items.map((i) => i.url)).toEqual(['https://x.test/2']);
  });

  it('is idempotent', async () => {
    addTopics('a');
    let calls = 0;
    const b = new FeedBuilder(h.db, noEmbeddings, [
      source('devto', (t) => {
        calls++;
        return [raw('devto', t, day(calls))];
      }),
    ]);
    const first = await b.build('2026-01-01');
    const second = await b.build('2026-01-01');
    expect(second).toEqual(first);
    expect(calls).toBe(1);
    expect(h.db.select().from(feeds).all()).toHaveLength(1);
  });

  it('returns an empty feed and writes no row with zero topics', async () => {
    const b = new FeedBuilder(h.db, noEmbeddings, [source('devto', () => [])]);
    const feed = await b.build('2026-01-01');
    expect(feed.items).toEqual([]);
    expect(h.db.select().from(feeds).all()).toHaveLength(0);
    addTopics('a');
    const later = new FeedBuilder(h.db, noEmbeddings, [
      source('devto', (t) => [raw('devto', t, day(1))]),
    ]);
    expect((await later.build('2026-01-01')).items).toHaveLength(1);
  });

  it('survives one source throwing', async () => {
    addTopics('a');
    const bad: MediaSource = {
      id: 'youtube',
      enabled: () => true,
      fetch: () => Promise.reject(new Error('boom')),
    };
    const b = new FeedBuilder(h.db, noEmbeddings, [
      bad,
      source('devto', (t) => [raw('devto', t, day(1))]),
    ]);
    const feed = await b.build('2026-01-01');
    expect(feed.items).toHaveLength(1);
    expect(h.db.select().from(feeds).all()).toHaveLength(1);
  });

  it('keeps the first topic for a duplicate url', async () => {
    addTopics('a', 'b');
    const b = new FeedBuilder(h.db, noEmbeddings, [
      source('devto', (t) => [raw('devto', t, day(1), 'https://x.test/same')]),
    ]);
    const feed = await b.build('2026-01-01');
    expect(feed.items.map((i) => i.topic)).toEqual(['a']);
  });

  describe('reselect', () => {
    const calls: string[] = [];
    const counting = (id: RawMediaItem['source'], n = 3) =>
      source(id, (t) => {
        calls.push(`${id}:${t}`);
        return Array.from({ length: n }, (_, i) => ({
          ...raw(id, t, day(i), `https://x.test/${id}/${t}/${i}`),
          title: `${id} ${t} story ${i}`,
        }));
      });
    const entries = (b: FeedBuilder) =>
      b
        .build('2026-01-01')
        .then((f) => f.items.map((i) => i.topic + i.url.at(-1)));
    const topicAt = (name: string, i: number) =>
      h.db
        .insert(topics)
        .values({ name, createdAt: `2026-01-01T00:00:0${i}.000Z` })
        .run();
    beforeEach(() => {
      calls.length = 0;
    });

    it('records the fetched topics on build', async () => {
      addTopics('a', 'b');
      await new FeedBuilder(h.db, noEmbeddings, [counting('devto')]).build(
        '2026-01-01',
      );
      expect(
        h.db
          .select()
          .from(feedTopicFetches)
          .all()
          .map((r) => r.topic)
          .sort(),
      ).toEqual(['a', 'b']);
    });

    it('does nothing when no feed exists', async () => {
      addTopics('a');
      const b = new FeedBuilder(h.db, noEmbeddings, [counting('devto')]);
      await b.reselect('2026-01-01');
      expect(calls).toEqual([]);
      expect(h.db.select().from(feeds).all()).toEqual([]);
    });

    it('does nothing and fetches nothing when the topics are unchanged', async () => {
      addTopics('a', 'b');
      const b = new FeedBuilder(h.db, noEmbeddings, [counting('devto')]);
      const before = await entries(b);
      calls.length = 0;
      await b.reselect('2026-01-01');
      expect(calls).toEqual([]);
      expect(await entries(b)).toEqual(before);
    });

    it('removes a removed topic and keeps the kept order', async () => {
      addTopics('a', 'b');
      const b = new FeedBuilder(h.db, noEmbeddings, [counting('devto')]);
      const before = await b.build('2026-01-01');
      const keptBefore = before.items
        .filter((i) => i.topic === 'a')
        .map((i) => i.id);
      h.db.delete(topics).where(eq(topics.name, 'b')).run();
      await b.reselect('2026-01-01');
      const after = await b.build('2026-01-01');
      expect(after.items.map((i) => i.id)).toEqual(keptBefore);
      expect(calls.length).toBe(2); // only the build's fetches
    });

    it('fetches an added topic once, after the kept entries, within the caps', async () => {
      addTopics('a');
      const many = (id: RawMediaItem['source']) => counting(id, 9);
      const b = new FeedBuilder(h.db, noEmbeddings, [many('devto')]);
      const before = await b.build('2026-01-01');
      topicAt('b', 5);
      await b.reselect('2026-01-01');
      await b.reselect('2026-01-01');
      expect(calls.filter((c) => c === 'devto:b')).toHaveLength(1);
      const after = await b.build('2026-01-01');
      expect(after.items.slice(0, before.items.length)).toEqual(before.items);
      expect(after.items.filter((i) => i.type === 'read')).toHaveLength(10);
      expect(after.items.filter((i) => i.topic === 'b')).toHaveLength(1);
    });

    it('fills freed slots with the added topic', async () => {
      addTopics('a', 'b');
      const b = new FeedBuilder(h.db, noEmbeddings, [counting('devto', 6)]);
      await b.build('2026-01-01'); // 12 candidates -> 10 read
      h.db.delete(topics).where(eq(topics.name, 'b')).run();
      topicAt('c', 7);
      await b.reselect('2026-01-01');
      const after = await b.build('2026-01-01');
      expect(after.items.filter((i) => i.topic === 'a')).toHaveLength(5);
      expect(after.items.filter((i) => i.topic === 'c')).toHaveLength(5);
      expect(after.items.map((i) => i.topic)).not.toContain('b');
    });
  });
});

describe('FeedBuilder title dedup', () => {
  let h: DbHandle;
  beforeEach(() => {
    h = openDatabase(':memory:');
    h.db
      .insert(topics)
      .values({ name: 'a', createdAt: '2026-01-01T00:00:00.000Z' })
      .run();
  });
  afterEach(() => h.sqlite.close());

  const titled = (
    src: RawMediaItem['source'],
    url: string,
    title: string,
  ): RawMediaItem => ({ ...raw(src, 'a', day(1), url), title });

  it('keeps a cross-posted article once, from the first source', async () => {
    const b = new FeedBuilder(h.db, noEmbeddings, [
      source('devto', () => [
        titled('devto', 'https://d.test/1', 'The Four Things!'),
      ]),
      source('medium', () => [
        titled('medium', 'https://m.test/1', 'the four  things 🚀'),
      ]),
    ]);
    const feed = await b.build('2026-01-01');
    expect(feed.items.map((i) => i.source)).toEqual(['devto']);
  });

  it('excludes a title repeated from an earlier day', async () => {
    let day2 = false;
    const b = new FeedBuilder(h.db, noEmbeddings, [
      source('devto', () => [
        titled('devto', 'https://d.test/1', 'Same Title'),
      ]),
      source('medium', () =>
        day2
          ? [
              titled('medium', 'https://m.test/1', 'same title'),
              titled('medium', 'https://m.test/2', 'Other'),
            ]
          : [],
      ),
    ]);
    await b.build('2026-01-01');
    day2 = true;
    const d2 = await b.build('2026-01-02');
    expect(d2.items.map((i) => i.url)).toEqual(['https://m.test/2']);
  });
});

describe('FeedBuilder embedding', () => {
  let h: DbHandle;
  beforeEach(() => {
    h = openDatabase(':memory:');
    h.db.insert(topics).values({ name: 'a' }).run();
  });
  afterEach(() => h.sqlite.close());

  const devto = (count: number) =>
    source('devto', (t) =>
      Array.from({ length: count }, (_, i) => raw('devto', t, day(i))),
    );

  it('hands the built feed items to the embedding step, and a failure keeps the feed', async () => {
    const embedMissing = vi.fn(async (items: unknown[]) => {
      void items;
    });
    const b = new FeedBuilder(h.db, { embedMissing }, [devto(3)]);
    const feed = await b.build('2026-01-01');
    expect(embedMissing).toHaveBeenCalledTimes(1);
    expect(embedMissing.mock.calls[0]![0]).toHaveLength(3);
    expect(feed.items).toHaveLength(3);
  });

  it('retries embedMissing in the background for a stored feed, one run at a time', async () => {
    const embedMissing = vi.fn(async (items: unknown[]) => {
      void items;
    });
    const b = new FeedBuilder(h.db, { embedMissing }, [devto(3)]);
    await b.build('2026-01-01'); // fresh build awaits its own embedding
    expect(embedMissing).toHaveBeenCalledTimes(1);

    // Second build: does not wait for the (still pending) run.
    let release2!: () => void;
    const gate2 = new Promise<void>((r) => (release2 = r));
    embedMissing.mockImplementation(async () => gate2);
    const stored = await b.build('2026-01-01');
    await vi.waitFor(() => expect(embedMissing).toHaveBeenCalledTimes(2));
    expect(embedMissing.mock.calls[1]![0]).toEqual(stored.items);

    // Overlapping calls start only one run.
    await b.build('2026-01-01');
    await b.build('2026-01-01');
    expect(embedMissing).toHaveBeenCalledTimes(2);
    release2();
  });

  it('logs a background rejection instead of surfacing it', async () => {
    const embedMissing = vi.fn(async (items: unknown[]) => {
      void items;
    });
    const b = new FeedBuilder(h.db, { embedMissing }, [devto(1)]);
    await b.build('2026-01-01');
    embedMissing.mockRejectedValueOnce(new Error('boom'));
    await expect(b.build('2026-01-01')).resolves.toBeDefined();
    await vi.waitFor(() => expect(embedMissing).toHaveBeenCalledTimes(2));
  });

  it('embeds only items without an embedding, and survives embedder failure', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map(() => fakeVec()));
    const store = new ItemEmbeddings(h, { embed });
    const b = new FeedBuilder(h.db, store, [devto(2)]);
    const feed = await b.build('2026-01-01');
    expect(embed.mock.calls[0]![0]).toHaveLength(2);

    await store.embedMissing(feed.items);
    expect(embed).toHaveBeenCalledTimes(1); // all already embedded

    const failing = new ItemEmbeddings(h, {
      embed: async () => {
        throw new Error('boom');
      },
    });
    h.sqlite.exec('DELETE FROM item_embeddings');
    await expect(failing.embedMissing(feed.items)).resolves.toBeUndefined();
  });
});

const fakeVec = () => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
