import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import type { MediaSource, RawMediaItem } from './media-source.js';
import { normalizeContent, normalizeSummary } from './classify.js';

const TIMEOUT_MS = 10_000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const VIDEOS_BATCH = 50;
const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** ISO 8601 duration (e.g. PT1H2M3S) to seconds; undefined when unparseable. */
export function parseIsoDuration(
  value: string | undefined,
): number | undefined {
  const m = ISO_DURATION.exec(value ?? '');
  if (!m || !value || value === 'P' || value.endsWith('T')) return undefined;
  const [d, h, min, sec] = m.slice(1).map((x) => Number(x ?? 0));
  return d! * 86400 + h! * 3600 + min! * 60 + sec!;
}

interface VideoItem {
  id?: string;
  snippet?: { description?: string };
  contentDetails?: { duration?: string };
}

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
        order: 'relevance',
        relevanceLanguage: 'en',
        videoDuration: 'medium',
        videoCategoryId: '28',
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
      const items = (body.items ?? [])
        .map((item) => this.toRaw(item))
        .filter((item): item is RawMediaItem => item !== null);
      await this.enrich(items, key);
      return items;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`youtube fetch failed for topic "${topic}": ${reason}`);
      return [];
    }
  }

  /** One batched videos.list call; on any failure keep the search data and warn once. */
  private async enrich(items: RawMediaItem[], key: string): Promise<void> {
    if (items.length === 0) return;
    try {
      const ids = items.map((i) => new URL(i.url).searchParams.get('v') ?? '');
      const requested = ids.slice(0, VIDEOS_BATCH);
      const params = new URLSearchParams({
        part: 'snippet,contentDetails',
        id: requested.join(','),
        key,
      });
      const res = await fetch(`${VIDEOS_URL}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { items?: VideoItem[] };
      const byId = new Map((body.items ?? []).map((v) => [v.id, v]));
      const missing = requested.filter((id) => !byId.has(id)).length;
      if (missing > 0) {
        this.logger.warn(
          `youtube videos.list omitted ${missing} of ${requested.length} videos`,
        );
      }
      items.forEach((item, i) => {
        const video = byId.get(ids[i]);
        if (!video) return;
        const description = video.snippet?.description;
        if (description) item.content = normalizeContent(description);
        const duration = parseIsoDuration(video.contentDetails?.duration);
        if (duration !== undefined) item.durationSec = duration;
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`youtube videos.list failed: ${reason}`);
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
      content: normalizeContent(s?.description ?? ''),
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
