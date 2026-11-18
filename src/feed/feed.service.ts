import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FeedComposer,
  InvalidTopicError,
  TooManyTopicsError,
} from './feed-composer.js';
import type { MediaItemRow } from './feed-items.js';

export const FEED_LIMITS = { read: 10, watch: 10, listen: 10 } as const;

export interface MediaItemDto {
  id: number;
  url: string;
  type: MediaItemRow['type'];
  source: MediaItemRow['source'];
  topic: string;
  title: string;
  summary: string;
  author: string | null;
  imageUrl: string | null;
  publishedAt: string;
  durationSec: number | null;
}

export interface FeedDto {
  date: string;
  limits: typeof FEED_LIMITS;
  counts: { read: number; watch: number; listen: number };
  items: MediaItemDto[];
  reason?: 'no-topics';
}

/** The server's local date as YYYY-MM-DD. */
export function localDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

@Injectable()
export class FeedService {
  constructor(private readonly composer: FeedComposer) {}

  async today(topics: string[]): Promise<FeedDto> {
    const date = localDate();
    let composed;
    try {
      composed = await this.composer.compose(topics, date);
    } catch (err) {
      if (err instanceof InvalidTopicError || err instanceof TooManyTopicsError)
        throw new BadRequestException(err.message);
      throw err;
    }
    const counts = { read: 0, watch: 0, listen: 0 };
    const items = composed.map((row): MediaItemDto => {
      counts[row.type]++;
      return {
        id: row.id,
        url: row.url,
        type: row.type,
        source: row.source,
        topic: row.topic,
        title: row.title,
        summary: row.summary,
        author: row.author,
        imageUrl: row.imageUrl,
        publishedAt: row.publishedAt,
        durationSec: row.durationSec,
      };
    });
    const dto: FeedDto = { date, limits: FEED_LIMITS, counts, items };
    if (topics.length === 0) dto.reason = 'no-topics';
    return dto;
  }
}
