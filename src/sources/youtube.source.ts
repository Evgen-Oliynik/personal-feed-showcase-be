import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import type { MediaSource, RawMediaItem } from './media-source.js';
import { normalizeSummary } from './classify.js';

const TIMEOUT_MS = 10_000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

interface SearchItem {
  id?: { videoId?: string };
  snippet?: {
    publishedAt?: string;
    title?: string;
    description?: string;
    channelTitle?: string;
    thumbnails?: { high?: { url?: string } };
  };
}

@Injectable()
export class YoutubeSource implements MediaSource {
  readonly id = 'youtube';
  private readonly logger = new Logger(YoutubeSource.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  enabled(): boolean {
    return Boolean(this.config.get('YOUTUBE_API_KEY', { infer: true }));
  }

  async fetch(topic: string, limit: number): Promise<RawMediaItem[]> {
    const key = this.config.get('YOUTUBE_API_KEY', { infer: true });
    if (!key) return [];
    try {
      const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        order: 'date',
        maxResults: String(limit),
        q: topic,
        publishedAfter: new Date(Date.now() - WINDOW_MS).toISOString(),
        key,
      });
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { items?: SearchItem[] };
      return (body.items ?? [])
        .map((item) => this.toRaw(item))
        .filter((item): item is RawMediaItem => item !== null);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`youtube fetch failed for topic "${topic}": ${reason}`);
      return [];
    }
  }

  private toRaw(item: SearchItem): RawMediaItem | null {
    const videoId = item.id?.videoId;
    const s = item.snippet;
    const title = normalizeSummary(s?.title ?? '');
    const date = Date.parse(s?.publishedAt ?? '');
    if (!videoId || !title || Number.isNaN(date)) return null;
    const raw: RawMediaItem = {
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      summary: normalizeSummary(s?.description ?? ''),
      publishedAt: new Date(date).toISOString(),
      source: 'youtube',
    };
    const author = s?.channelTitle ? normalizeSummary(s.channelTitle) : '';
    if (author) raw.author = author;
    const imageUrl = s?.thumbnails?.high?.url;
    if (imageUrl) raw.imageUrl = imageUrl;
    return raw;
  }
}
