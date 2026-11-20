import { Inject, Injectable } from '@nestjs/common';
import type { DbHandle } from '../db/database.js';
import { DB_HANDLE } from '../db/db.module.js';
import { FeedComposer } from '../feed/feed-composer.js';
import { localDate } from '../feed/feed.service.js';
import { EMBEDDER, type Embedder } from './embedder.js';
import { rankFeedItems } from './hybrid-rank.js';
import { ITEM_EMBEDDINGS, type ItemEmbeddingStore } from './item-embeddings.js';
import { LLM, type Llm, type LlmMessage } from './llm.js';

export const NOT_COVERED = 'This is not in the collected materials';
/** Most feed items the chat sees. */
const FEED_LIMIT = 30;
/** Ranked items that also carry their full content. */
export const FULL_CONTENT_TOP = 8;

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
  content: string | null;
}

export const CHAT_SYSTEM_PROMPT = `You answer questions about today's feed using only the numbered items given by the user.
Cite the items you use as [n]. Answer only from those items.
Answer completely: combine information across items and prefer the most relevant items (they come first; the top ones include their full content).
Questions about the feed as a whole (e.g. "what's worth reading today?") are answered from all the items.
If the items do not contain the answer, reply exactly: ${NOT_COVERED}`;

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(LLM) private readonly llm: Llm,
    private readonly composer: FeedComposer,
    @Inject(ITEM_EMBEDDINGS) private readonly embeddings: ItemEmbeddingStore,
  ) {}

  async answer(
    question: string,
    topics: string[],
    history: LlmMessage[] = [],
  ): Promise<ChatAnswer> {
    // A follow-up ("tell me more about it") is ranked together with the previous user turn.
    const previous = history.findLast((m) => m.role === 'user');
    const query = previous ? `${previous.content}\n${question}` : question;
    const rows = await this.rankedFeed(query, topics);
    if (rows.length === 0) {
      return { sources: [], tokens: single(NOT_COVERED) };
    }
    const user = [
      ...rows.map((r, i) => {
        const line = `[${i + 1}] ${r.title} — ${r.source} — ${r.type} — ${r.url} — ${r.summary}`;
        return i < FULL_CONTENT_TOP && r.content
          ? `${line}\nFull content: ${r.content}`
          : line;
      }),
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
      tokens: this.llm.stream(CHAT_SYSTEM_PROMPT, [
        ...history,
        { role: 'user', content: user },
      ]),
    };
  }

  private async rankedFeed(question: string, topics: string[]): Promise<Row[]> {
    const composed = await this.composer.compose(topics, localDate());
    const feed = composed.slice(0, FEED_LIMIT);
    if (feed.length === 0) return [];
    // Items whose embedding failed at fetch time are embedded now (no-op when none are missing).
    await this.embeddings.embedMissing(feed);
    return rankFeedItems(
      { handle: this.handle, embedder: this.embedder },
      question,
      feed,
    );
  }
}

async function* single(text: string): AsyncIterable<string> {
  await Promise.resolve();
  yield text;
}
