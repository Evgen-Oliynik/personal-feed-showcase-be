import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DbHandle } from '../db/database.js';
import { mediaItems, topicFetches, topicItems } from '../db/schema.js';
import type { MediaSource, RawMediaItem } from '../sources/media-source.js';
import { TopicPool } from './topic-pool.js';

const raw = (url: string, title = url): RawMediaItem => ({
  url,
  title,
  summary: 's',
  publishedAt: '2026-01-01T00:00:00.000Z',
  source: 'devto',
});

const src = (
  fetch: MediaSource['fetch'],
  id: MediaSource['id'] = 'devto',
): MediaSource => ({ id, enabled: () => true, fetch });

describe('TopicPool', () => {
  let h: DbHandle;
  const embedMissing = vi.fn(async (_items: unknown[]) => {});
  beforeEach(() => {
    h = openDatabase(':memory:');
    embedMissing.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    h.sqlite.close();
  });

  const pool = (...sources: MediaSource[]) =>
    new TopicPool(h.db, { embedMissing }, sources);

  it('fetches once per (topic, date), concurrent calls included', async () => {
    const fetch = vi.fn(async () => [raw('https://x.test/1')]);
    const p = pool(src(fetch));
    await Promise.all([
      p.ensure('a', '2026-01-01'),
      p.ensure('a', '2026-01-01'),
    ]);
    await p.ensure('a', '2026-01-01');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.db.select().from(topicFetches).all()).toHaveLength(1);
    await p.ensure('a', '2026-01-02');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reuses an existing item for a second topic, keeping first_seen_date', async () => {
    const p = pool(src(async () => [raw('https://x.test/1')]));
    await p.ensure('a', '2026-01-01');
    h.db
      .update(mediaItems)
      .set({ firstSeenDate: '2020-05-05' })
      .where(eq(mediaItems.url, 'https://x.test/1'))
      .run();
    await p.ensure('b', '2026-01-02');
    const items = h.db.select().from(mediaItems).all();
    expect(items).toHaveLength(1);
    expect(items[0]!.firstSeenDate).toBe('2020-05-05');
    expect(items[0]!.topic).toBe('a');
    const links = h.db.select().from(topicItems).all();
    expect(links.map((l) => l.topic).sort()).toEqual(['a', 'b']);
  });

  it('skips items whose normalized title is already in the pool', async () => {
    const p = pool(
      src(async () => [
        raw('https://x.test/1', 'Hello, World!'),
        raw('https://x.test/2', 'hello world'),
        raw('https://x.test/3', 'Other'),
      ]),
    );
    await p.ensure('a', '2026-01-01');
    expect(h.db.select().from(topicItems).all()).toHaveLength(2);
    expect(h.db.select().from(mediaItems).all()).toHaveLength(2);
  });

  it('survives a failing source', async () => {
    const p = pool(
      src(async () => {
        throw new Error('boom');
      }, 'medium'),
      src(async () => [raw('https://x.test/1')]),
    );
    await expect(p.ensure('a', '2026-01-01')).resolves.toBeUndefined();
    expect(h.db.select().from(topicItems).all()).toHaveLength(1);
  });

  it('writes no row when every source rejects, and fetches again', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    let down = true;
    const fetch = vi.fn(async () => {
      if (down) throw new Error('boom');
      return [raw('https://x.test/1')];
    });
    const p = pool(src(fetch, 'devto'), src(fetch, 'medium'));
    await p.ensure('a', '2026-01-01');
    expect(h.db.select().from(topicFetches).all()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(2);
    down = false;
    await p.ensure('a', '2026-01-01');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      h.db
        .select()
        .from(topicFetches)
        .all()
        .map((r) => r.source)
        .sort(),
    ).toEqual(['devto', 'medium']);
    expect(h.db.select().from(topicItems).all()).toHaveLength(1);
    warn.mockRestore();
  });

  it('refetches only the source that rejected', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let down = true;
    const good = vi.fn(async () => [raw('https://x.test/1')]);
    const flaky = vi.fn(async () => {
      if (down) throw new Error('boom');
      return [raw('https://x.test/2')];
    });
    const p = pool(src(good, 'devto'), src(flaky, 'medium'));
    await p.ensure('a', '2026-01-01');
    expect(h.db.select().from(topicFetches).all()).toHaveLength(1);
    down = false;
    await p.ensure('a', '2026-01-01');
    expect(good).toHaveBeenCalledTimes(1);
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(h.db.select().from(topicFetches).all()).toHaveLength(2);
    expect(h.db.select().from(topicItems).all()).toHaveLength(2);
  });

  it('does not refetch a source that resolved empty', async () => {
    const fetch = vi.fn(async () => []);
    const p = pool(src(fetch));
    await p.ensure('a', '2026-01-01');
    await p.ensure('a', '2026-01-01');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.db.select().from(topicFetches).all()).toHaveLength(1);
  });

  it('embeds new items only', async () => {
    const p = pool(src(async () => [raw('https://x.test/1')]));
    await p.ensure('a', '2026-01-01');
    expect(embedMissing.mock.calls[0]![0]).toHaveLength(1);
    await p.ensure('b', '2026-01-01');
    expect(embedMissing.mock.calls[1]![0]).toHaveLength(0);
  });
});
