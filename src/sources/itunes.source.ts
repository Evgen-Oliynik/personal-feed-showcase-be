import { Injectable, Logger } from '@nestjs/common';
import type { MediaSource, RawMediaItem } from './media-source.js';
import { normalizeSummary } from './classify.js';

const TIMEOUT_MS = 10_000;
const SEARCH_URL = 'https://itunes.apple.com/search';

interface ItunesResult {
  trackViewUrl?: string;
  trackName?: string;
  description?: string;
  collectionName?: string;
  artworkUrl600?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  episodeContentType?: string;
  episodeFileExtension?: string;
}

const EXTENSION_MIME: Record<string, string> = {
  mp3: 'mpeg',
  m4a: 'mp4',
  m4v: 'mp4',
};

function toMime(type?: string, ext?: string): string | undefined {
  if (!type || !ext) return undefined;
  const e = ext.toLowerCase();
  return `${type.toLowerCase()}/${EXTENSION_MIME[e] ?? e}`;
}

@Injectable()
export class ItunesSource implements MediaSource {
  readonly id = 'itunes';
  private readonly logger = new Logger(ItunesSource.name);

  enabled(): boolean {
    return true;
  }

  async fetch(topic: string, limit: number): Promise<RawMediaItem[]> {
    try {
      const params = new URLSearchParams({
        media: 'podcast',
        entity: 'podcastEpisode',
        term: topic,
        limit: String(limit),
      });
      const res = await fetch(`${SEARCH_URL}?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { results?: ItunesResult[] };
      return (body.results ?? [])
        .map((r) => this.toRaw(r))
        .filter((item): item is RawMediaItem => item !== null);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`itunes fetch failed for topic "${topic}": ${reason}`);
      return [];
    }
  }

  private toRaw(r: ItunesResult): RawMediaItem | null {
    const title = normalizeSummary(r.trackName ?? '');
    const date = Date.parse(r.releaseDate ?? '');
    if (!r.trackViewUrl || !title || Number.isNaN(date)) return null;
    const raw: RawMediaItem = {
      url: r.trackViewUrl,
      title,
      summary: normalizeSummary(r.description ?? ''),
      publishedAt: new Date(date).toISOString(),
      source: 'itunes',
    };
    const author = r.collectionName ? normalizeSummary(r.collectionName) : '';
    if (author) raw.author = author;
    if (r.artworkUrl600) raw.imageUrl = r.artworkUrl600;
    if (typeof r.trackTimeMillis === 'number') {
      raw.durationSec = r.trackTimeMillis / 1000;
    }
    const mime = toMime(r.episodeContentType, r.episodeFileExtension);
    if (mime) raw.enclosureMimeType = mime;
    return raw;
  }
}
