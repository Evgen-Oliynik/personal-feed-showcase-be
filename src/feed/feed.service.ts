import { Injectable } from '@nestjs/common';
import { FeedBuilder, type MediaItemRow } from './feed-builder.js';

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
  builtAt: string | null;
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
  private readonly inFlight = new Map<string, Promise<FeedDto>>();

  constructor(private readonly builder: FeedBuilder) {}

  today(): Promise<FeedDto> {
    const date = localDate();
    let pending = this.inFlight.get(date);
    if (!pending) {
      pending = this.load(date).finally(() => this.inFlight.delete(date));
      this.inFlight.set(date, pending);
    }
    return pending;
  }

  private async load(date: string): Promise<FeedDto> {
    const feed = await this.builder.build(date);
    const counts = { read: 0, watch: 0, listen: 0 };
    const items = feed.items.map((row): MediaItemDto => {
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
    const dto: FeedDto = {
      date,
      builtAt: feed.builtAt,
      limits: FEED_LIMITS,
      counts,
      items,
    };
    if (feed.builtAt === null) dto.reason = 'no-topics';
    return dto;
  }
}
