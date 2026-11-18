import { Injectable } from '@nestjs/common';
import type { MediaSource, RawMediaItem } from './media-source.js';
import { normalizeContent, normalizeSummary } from './classify.js';

const TIMEOUT_MS = 10_000;
const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const SEARCH_LIMIT = 50;
const TECHNOLOGY_GENRE_ID = '1318';
const SEARCH_URL = 'https://itunes.apple.com/search';

interface ItunesResult {
  trackViewUrl?: string;
  trackName?: string;
  description?: string;
  collectionName?: string;
  artworkUrl600?: string;
  releaseDate?: string;
  genres?: { id?: string; name?: string }[];
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

  enabled(): boolean {
    return true;
  }

  async fetch(topic: string, limit: number): Promise<RawMediaItem[]> {
    const params = new URLSearchParams({
      media: 'podcast',
      entity: 'podcastEpisode',
      term: topic,
      limit: String(SEARCH_LIMIT),
    });
    const res = await fetch(`${SEARCH_URL}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { results?: ItunesResult[] };
    const cutoff = Date.now() - WINDOW_MS;
    return (body.results ?? [])
      .filter((r) => r.genres?.some((g) => g.id === TECHNOLOGY_GENRE_ID))
      .map((r) => this.toRaw(r))
      .filter(
        (item): item is RawMediaItem =>
          item !== null && Date.parse(item.publishedAt) >= cutoff,
      )
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);
  }

  private toRaw(r: ItunesResult): RawMediaItem | null {
    const title = normalizeSummary(r.trackName ?? '');
    const date = Date.parse(r.releaseDate ?? '');
    if (!r.trackViewUrl || !title || Number.isNaN(date)) return null;
    const raw: RawMediaItem = {
      url: r.trackViewUrl,
      title,
      summary: normalizeSummary(r.description ?? ''),
      content: normalizeContent(r.description ?? ''),
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
