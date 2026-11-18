import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import type { DbHandle } from '../db/database.js';
import { DB_HANDLE } from '../db/db.module.js';
import { FeedComposer } from '../feed/feed-composer.js';
import { localDate } from '../feed/feed.service.js';
import { EMBEDDER, type Embedder } from './embedder.js';
import { LLM, type Llm } from './llm.js';

export const NOT_COVERED = 'This is not in the collected materials';
export const CHAT_TOP_K = 6;
/** vec0 caps k at 4096. */
const MAX_KNN = 4096;

export interface ChatSource {
  n: number;
  id: number;
  title: string;
  url: string;
  type: 'read' | 'watch' | 'listen';
  source: string;
}

export interface ChatAnswer {
  sources: ChatSource[];
  tokens: AsyncIterable<string>;
}

interface Row {
  id: number;
  title: string;
  url: string;
  type: ChatSource['type'];
  source: string;
  summary: string;
}

export const CHAT_SYSTEM_PROMPT = `You answer questions about today's feed using only the numbered items given by the user.
Cite the items you use as [n]. Answer only from those items.
If the items do not contain the answer, reply exactly: ${NOT_COVERED}`;

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(LLM) private readonly llm: Llm,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly composer: FeedComposer,
  ) {}

  async answer(question: string, topics: string[]): Promise<ChatAnswer> {
    const rows = await this.retrieve(question, topics);
    if (rows.length === 0) {
      return { sources: [], tokens: single(NOT_COVERED) };
    }
    const user = [
      ...rows.map(
        (r, i) =>
          `[${i + 1}] ${r.title} — ${r.source} — ${r.url} — ${r.summary}`,
      ),
      '',
      `Question: ${question}`,
    ].join('\n');
    return {
      sources: rows.map((r, i) => ({
        n: i + 1,
        id: r.id,
        title: r.title,
        url: r.url,
        type: r.type,
        source: r.source,
      })),
      tokens: this.llm.stream(CHAT_SYSTEM_PROMPT, user),
    };
  }

  private async retrieve(question: string, topics: string[]): Promise<Row[]> {
    const { sqlite } = this.handle;
    const feed = await this.composer.compose(topics, localDate());
    if (feed.length === 0) return [];
    const byId = new Map<number, Row>(feed.map((r) => [r.id, r]));

    const [vector] = await this.embedder.embed([question]);
    // KNN runs over every embedding, then is restricted to the feed's items,
    // so k must cover the whole table or other items could crowd them out.
    const hits = sqlite
      .prepare(
        'SELECT media_item_id, distance FROM item_embeddings WHERE embedding MATCH ? AND k = ?',
      )
      .all(new Float32Array(vector!), BigInt(MAX_KNN)) as {
      media_item_id: number | bigint;
      distance: number;
    }[];

    const max = this.config.get('CHAT_MAX_DISTANCE', { infer: true });
    const out: Row[] = [];
    for (const h of hits) {
      const row = byId.get(Number(h.media_item_id));
      if (row && h.distance <= max) out.push(row);
      if (out.length === CHAT_TOP_K) break;
    }
    return out;
  }
}

async function* single(text: string): AsyncIterable<string> {
  await Promise.resolve();
  yield text;
}
