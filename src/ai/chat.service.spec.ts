import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import { openDatabase, type DbHandle } from '../db/database.js';
import { localDate } from '../feed/feed.service.js';
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

  async function add(id: number, title: string, date: string | null) {
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
    if (date) {
      handle.sqlite
        .prepare(
          "INSERT INTO topic_items(topic,fetch_date,media_item_id) VALUES ('t',?,?)",
        )
        .run(date, id);
    }
    const [v] = await embedder.embed([`${title}\nAbout ${title}`]);
    handle.sqlite
      .prepare(
        'INSERT INTO item_embeddings(media_item_id, embedding) VALUES (?, ?)',
      )
      .run(BigInt(id), new Float32Array(v!));
  }

  beforeEach(() => {
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
    service = new ChatService(handle, embedder, llm as unknown as Llm, config);
  });

  afterEach(() => handle.sqlite.close());

  it('does not call the LLM when nothing matches', async () => {
    await add(1, 'rust async runtime', localDate());
    const res = await service.answer('banana smoothie recipe');
    expect(res.sources).toEqual([]);
    expect(await collect(res.tokens)).toBe(NOT_COVERED);
    expect(llm.stream).not.toHaveBeenCalled();
  });

  it('numbers sources in retrieval order and builds the prompt', async () => {
    const today = localDate();
    await add(1, 'rust async tokio', today);
    await add(2, 'rust async', today);
    const res = await service.answer('rust async');
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

  it('only retrieves items in today’s feed', async () => {
    await add(1, 'rust async', '2000-01-01');
    await add(2, 'rust async', null);
    await add(3, 'rust async', localDate());
    const res = await service.answer('rust async');
    expect(res.sources.map((s) => s.id)).toEqual([3]);
  });
});
