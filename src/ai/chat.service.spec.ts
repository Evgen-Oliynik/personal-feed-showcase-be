import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import { openDatabase, type DbHandle } from '../db/database.js';
import type { FeedComposer } from '../feed/feed-composer.js';
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

  async function add(id: number, title: string, topic: string | null) {
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
    });
    if (topic) feeds.set(topic, [...(feeds.get(topic) ?? []), id]);
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
    const config = { get: () => 0.6 } as unknown as ConfigService<
      AppConfig,
      true
    >;
    service = new ChatService(handle, embedder, llm as unknown as Llm, config, {
      compose,
    } as unknown as FeedComposer);
  });

  afterEach(() => handle.sqlite.close());

  it('does not call the LLM when nothing matches', async () => {
    await add(1, 'rust async runtime', 'a');
    const res = await service.answer('banana smoothie recipe', ['a']);
    expect(res.sources).toEqual([]);
    expect(await collect(res.tokens)).toBe(NOT_COVERED);
    expect(llm.stream).not.toHaveBeenCalled();
  });

  it('numbers sources in retrieval order and builds the prompt', async () => {
    await add(1, 'rust async tokio', 'a');
    await add(2, 'rust async', 'a');
    const res = await service.answer('rust async', ['a']);
    expect(res.sources.map((s) => [s.n, s.id])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(await collect(res.tokens)).toBe('ok [1]');
    const [system, user] = llm.stream.mock.calls[0] as [string, string];
    expect(system).toContain(NOT_COVERED);
    expect(user).toContain(
      '[1] rust async — devto — https://x.test/2 — About rust async',
    );
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
});
