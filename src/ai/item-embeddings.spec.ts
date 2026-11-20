import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database.js';
import { FakeEmbedder } from './embedder.js';
import { ItemEmbeddings } from './item-embeddings.js';

describe('ItemEmbeddings.embedMissing', () => {
  const handle = openDatabase(':memory:');
  afterEach(() => handle.sqlite.exec('DELETE FROM item_chunks'));

  function seed(id: number) {
    handle.sqlite
      .prepare(
        `INSERT OR IGNORE INTO media_items(id,url,type,source,topic,title,summary,published_at,fetched_at,first_seen_date)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        `https://x.test/${id}`,
        'read',
        'devto',
        't',
        'T',
        's',
        'p',
        'f',
        'd',
      );
  }
  const count = (t: string) =>
    (
      handle.sqlite.prepare(`SELECT count(*) c FROM ${t}`).get() as {
        c: number;
      }
    ).c;

  it('stores chunks and vectors once per item', async () => {
    seed(1);
    const embedder = new FakeEmbedder();
    const spy = vi.spyOn(embedder, 'embed');
    const store = new ItemEmbeddings(handle, embedder);
    const item = { id: 1, title: 'T', summary: 's', content: 'x'.repeat(1000) };
    await store.embedMissing([item]);
    expect(count('item_chunks')).toBe(2);
    expect(count('chunk_embeddings')).toBe(2);
    expect(spy).toHaveBeenCalledWith(expect.any(Array), 'passage');
    await store.embedMissing([item]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows an embedder failure', async () => {
    seed(2);
    const embedder = {
      embed: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const store = new ItemEmbeddings(handle, embedder);
    await expect(
      store.embedMissing([{ id: 2, title: 'T', summary: 's', content: null }]),
    ).resolves.toBeUndefined();
    expect(count('item_chunks')).toBe(0);
  });
});
