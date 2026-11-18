import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DbHandle } from './database.js';
import { feedEntries, feeds, mediaItems, topics } from './schema.js';

const vec = (hot: number) =>
  new Float32Array(384).fill(0).map((_, i) => (i === hot ? 1 : 0));

describe('database', () => {
  let h: DbHandle;
  beforeEach(() => {
    h = openDatabase(':memory:');
  });
  afterEach(() => h.sqlite.close());

  it('inserts and reads one row of each table', () => {
    const { db } = h;
    db.insert(topics).values({ name: 'ai' }).run();
    expect(db.select().from(topics).get()?.name).toBe('ai');

    const item = db
      .insert(mediaItems)
      .values({
        url: 'https://x.test/1',
        type: 'read',
        source: 'devto',
        topic: 'ai',
        title: 't',
        summary: 's',
        publishedAt: '2026-01-01T00:00:00Z',
        fetchedAt: '2026-01-02T00:00:00Z',
        firstSeenDate: '2026-01-02',
      })
      .returning()
      .get();
    expect(item.author).toBeNull();

    db.insert(feeds).values({ feedDate: '2026-01-02', builtAt: 'now' }).run();
    db.insert(feedEntries)
      .values({ feedDate: '2026-01-02', mediaItemId: item.id, position: 0 })
      .run();
    expect(
      db
        .select()
        .from(feedEntries)
        .where(eq(feedEntries.feedDate, '2026-01-02'))
        .get()?.position,
    ).toBe(0);
    expect(db.select().from(feeds).get()?.builtAt).toBe('now');
  });

  it('runs a KNN query on item_embeddings', () => {
    const ins = h.sqlite.prepare(
      'INSERT INTO item_embeddings(media_item_id, embedding) VALUES (?, ?)',
    );
    ins.run(1n, vec(0));
    ins.run(2n, vec(1));
    const rows = h.sqlite
      .prepare(
        'SELECT media_item_id, distance FROM item_embeddings WHERE embedding MATCH ? AND k = 1',
      )
      .all(vec(1)) as { media_item_id: number }[];
    expect(rows.map((r) => r.media_item_id)).toEqual([2]);
  });
});
