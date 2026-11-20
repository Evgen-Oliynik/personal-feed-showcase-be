import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DbHandle } from '../db/database.js';
import type { FeedComposer } from '../feed/feed-composer.js';
import { ItemEmbeddings } from './item-embeddings.js';
import { ChatService, NOT_COVERED } from './chat.service.js';
import { FakeEmbedder } from './embedder.js';
import type { Llm } from './llm.js';

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const t of it) out += t;
  return out;
}

describe('ChatService', () => {
  let handle: DbHandle;
  let llm: { stream: ReturnType<typeof vi.fn> };
  let service: ChatService;
  let embedSpy: ReturnType<typeof vi.spyOn>;
  const embedder = new FakeEmbedder();
  /** topic → items in that topic's feed (what `FeedComposer.compose` returns). */
  const feeds = new Map<string, number[]>();
  const compose = vi.fn((topics: string[]) => {
    const ids = new Set(topics.flatMap((t) => feeds.get(t) ?? []));
    return Promise.resolve(
      [...ids].map((id) => rows.get(id)).filter((r) => r !== undefined),
    );
  });
  const rows = new Map<number, object>();

  async function add(
    id: number,
    title: string,
    topic: string | null,
    withChunks = true,
    content: string | null = null,
  ) {
    handle.sqlite
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
        title,
        `About ${title}`,
        'p',
        'f',
        'd',
      );
    rows.set(id, {
      id,
      url: `https://x.test/${id}`,
      type: 'read',
      source: 'devto',
      title,
      summary: `About ${title}`,
      content,
    });
    if (topic) feeds.set(topic, [...(feeds.get(topic) ?? []), id]);
    if (!withChunks) return;
    const [v] = await embedder.embed([`${title}\nAbout ${title}`], 'passage');
    handle.sqlite
      .prepare(
        'INSERT INTO item_chunks(id, media_item_id, idx, text) VALUES (?, ?, 0, ?)',
      )
      .run(BigInt(id), BigInt(id), `About ${title}`);
    handle.sqlite
      .prepare(
        'INSERT INTO chunk_embeddings(chunk_id, embedding) VALUES (?, ?)',
      )
      .run(BigInt(id), new Float32Array(v!));
  }

  beforeEach(() => {
    feeds.clear();
    rows.clear();
    compose.mockClear();
    handle = openDatabase(':memory:');
    llm = {
      stream: vi.fn(async function* () {
        await Promise.resolve();
        yield 'ok [1]';
      }),
    };
    embedSpy = vi.spyOn(embedder, 'embed');
    service = new ChatService(
      handle,
      embedder,
      llm as unknown as Llm,
      { compose } as unknown as FeedComposer,
      new ItemEmbeddings(handle, embedder),
    );
  });

  afterEach(() => {
    embedSpy.mockRestore();
    handle.sqlite.close();
  });

  it('keeps a distant item in the context (no threshold)', async () => {
    await add(1, 'rust async runtime', 'a');
    const res = await service.answer('banana smoothie recipe', ['a']);
    expect(res.sources.map((s) => s.id)).toEqual([1]);
    expect(llm.stream).toHaveBeenCalledOnce();
  });

  it('puts every item in ranked order and numbers sources like the prompt', async () => {
    await add(1, 'rust async tokio', 'a');
    await add(2, 'rust async', 'a');
    await add(3, 'banana smoothie', 'a');
    const res = await service.answer('rust async', ['a']);
    expect(res.sources.map((s) => [s.n, s.id])).toEqual([
      [1, 2],
      [2, 1],
      [3, 3],
    ]);
    expect(await collect(res.tokens)).toBe('ok [1]');
    const [system, user] = llm.stream.mock.calls[0] as [string, string];
    expect(system).toContain(NOT_COVERED);
    const lines = user.split('\n').filter((l) => /^\[\d+\]/.test(l));
    expect(lines).toEqual([
      '[1] rust async — devto — read — https://x.test/2 — About rust async',
      '[2] rust async tokio — devto — read — https://x.test/1 — About rust async tokio',
      '[3] banana smoothie — devto — read — https://x.test/3 — About banana smoothie',
    ]);
  });

  it('adds full content for the top 8 ranked items only', async () => {
    for (let id = 1; id <= 10; id++)
      await add(id, `rust async ${id}`, 'a', true, `BODY${id}`);
    const res = await service.answer('rust async', ['a']);
    const [, user] = llm.stream.mock.calls[0] as [string, string];
    expect(res.sources).toHaveLength(10);
    expect(user.match(/Full content: BODY\d+/g)).toHaveLength(8);
    const top = res.sources.slice(0, 8).map((s) => `BODY${s.id}`);
    for (const b of top) expect(user).toContain(`Full content: ${b}`);
    for (const s of res.sources.slice(8))
      expect(user).not.toContain(`BODY${s.id}`);
  });

  it('does not call the LLM when the feed is empty', async () => {
    await add(1, 'rust async runtime', null);
    const res = await service.answer('rust async', ['a']);
    expect(res.sources).toEqual([]);
    expect(await collect(res.tokens)).toBe(NOT_COVERED);
    expect(llm.stream).not.toHaveBeenCalled();
  });

  it('only retrieves items in the given topics’ feed', async () => {
    await add(1, 'rust async', null);
    await add(2, 'rust async', 'b');
    await add(3, 'rust async', 'a');
    const res = await service.answer('rust async', ['a']);
    expect(compose.mock.calls[0]![0]).toEqual(['a']);
    expect(res.sources.map((s) => s.id)).toEqual([3]);
  });

  it('answers not-in-materials without the LLM when there are no topics', async () => {
    await add(1, 'rust async', 'a');
    const res = await service.answer('rust async', []);
    expect(res.sources).toEqual([]);
    expect(await collect(res.tokens)).toBe(NOT_COVERED);
    expect(llm.stream).not.toHaveBeenCalled();
  });

  it('embeds a feed item with no chunks before retrieval, then finds it', async () => {
    await add(1, 'rust async runtime', 'a', false);
    const res = await service.answer('rust async runtime', ['a']);
    expect(res.sources.map((s) => s.id)).toEqual([1]);
    const chunks = handle.sqlite
      .prepare('SELECT count(*) AS n FROM item_chunks WHERE media_item_id = 1')
      .get() as { n: number };
    expect(chunks.n).toBe(1);
  });

  it('makes no passage embedding call when every item has chunks', async () => {
    await add(1, 'rust async runtime', 'a');
    embedSpy.mockClear();
    await service.answer('rust async runtime', ['a']);
    expect(embedSpy.mock.calls.map((c: unknown[]) => c[1])).toEqual(['query']);
  });
});
