import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { EMBEDDING_DIMENSIONS, type Embedder } from './embedder.js';
import { buildFtsQuery, fuse, rankFeedItems } from './hybrid-rank.js';

function vec(axis: number): Float32Array {
  const v = new Float32Array(EMBEDDING_DIMENSIONS);
  v[axis] = 1;
  return v;
}

describe('buildFtsQuery', () => {
  it('lowercases, drops stopwords and 1-char words, quotes and ORs', () => {
    expect(buildFtsQuery('What is Bun and C?')).toBe('"bun"');
    expect(buildFtsQuery('React 19 hooks')).toBe('"react" OR "19" OR "hooks"');
  });
  it('returns undefined with no remaining term', () => {
    expect(buildFtsQuery('what is the a')).toBeUndefined();
    expect(buildFtsQuery('"*-(:')).toBeUndefined();
  });
  it('keeps c# and c++ as one term', () => {
    expect(buildFtsQuery('c# vs c++')).toBe('"c#" OR "vs" OR "c++"');
  });
});

describe('fuse', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  it('sums 1/(60+rank) over the rankings', () => {
    // 3: 1/61 + 1/62 beats 1: 1/61 and 2: 1/62.
    const out = fuse(
      items,
      [
        [3, 2],
        [3, 1],
      ],
      new Map(),
    );
    expect(out.map((i) => i.id)).toEqual([3, 1, 2]);
  });
  it('breaks ties by dense distance, then feed position', () => {
    const d = new Map([
      [2, 0.1],
      [3, 0.2],
    ]);
    expect(fuse(items, [[3], [2]], d).map((i) => i.id)).toEqual([2, 3, 1]);
    expect(fuse(items, [], new Map()).map((i) => i.id)).toEqual([1, 2, 3]);
  });
});

describe('rankFeedItems', () => {
  const handle = openDatabase(':memory:');
  const { sqlite } = handle;
  // Query always embeds to axis 0; item 1 is dense-closest, item 2 is not.
  const embedder: Embedder = {
    embed: (texts) => Promise.resolve(texts.map(() => [...vec(0)])),
  };
  const texts: Record<number, string> = {
    1: 'general programming tips',
    2: 'Bun is a fast runtime; also c# and c++ notes',
    3: 'unrelated cooking',
  };
  for (const id of [1, 2, 3]) {
    sqlite
      .prepare(
        `INSERT INTO media_items(id,url,type,source,topic,title,summary,published_at,fetched_at,first_seen_date)
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
    const { lastInsertRowid } = sqlite
      .prepare(
        'INSERT INTO item_chunks(media_item_id, idx, text) VALUES (?, 0, ?)',
      )
      .run(id, texts[id]);
    sqlite
      .prepare(
        'INSERT INTO chunk_embeddings(chunk_id, embedding) VALUES (?, ?)',
      )
      .run(BigInt(lastInsertRowid), id === 1 ? vec(0) : vec(id));
    sqlite
      .prepare('INSERT INTO chunk_fts(rowid, text) VALUES (?, ?)')
      .run(BigInt(lastInsertRowid), texts[id]);
  }
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const rank = async (q: string) =>
    (await rankFeedItems({ handle, embedder }, q, items)).map((i) => i.id);

  it('ranks the exact-term item first although dense prefers another', async () => {
    expect((await rank('bun'))[0]).toBe(2);
  });
  it('falls back to the dense ranking for a stopword-only question', async () => {
    expect((await rank('what is the')).slice(0, 1)).toEqual([1]);
  });
  it('never throws on FTS5 syntax characters', async () => {
    for (const q of [
      '"bun"',
      'bun*',
      'bun -react',
      '(bun',
      'a:b',
      'AND OR NOT',
      '"',
    ]) {
      await expect(rank(q)).resolves.toHaveLength(3);
    }
  });
  it('matches c# and c++ as terms', async () => {
    expect((await rank('c#'))[0]).toBe(2);
    expect((await rank('c++'))[0]).toBe(2);
  });
  it('removes fts rows with their chunks', () => {
    sqlite.exec('DELETE FROM item_chunks WHERE media_item_id = 3');
    const n = sqlite
      .prepare(
        "SELECT count(*) c FROM chunk_fts WHERE chunk_fts MATCH 'cooking'",
      )
      .get() as { c: number };
    expect(n.c).toBe(0);
  });
});
