import Parser from 'rss-parser';
import type {
  MediaSource,
  MediaSourceId,
  RawMediaItem,
} from './media-source.js';
import { normalizeContent, normalizeSummary } from './classify.js';

const TIMEOUT_MS = 10_000;
const FIRST_IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i;

type FeedItem = Parser.Item & { 'content:encoded'?: string };

/** Topic with spaces removed and URL-encoded, e.g. "machine learning" -> "machinelearning". */
export function toTag(topic: string): string {
  return encodeURIComponent(topic.replace(/\s+/g, ''));
}

export abstract class RssSource implements MediaSource {
  abstract readonly id: MediaSourceId;
  protected abstract feedUrl(tag: string): string;
  private readonly parser = new Parser();

  enabled(): boolean {
    return true;
  }

  async fetch(topic: string, limit: number): Promise<RawMediaItem[]> {
    const res = await fetch(this.feedUrl(toTag(topic)), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const feed = await this.parser.parseString(await res.text());
    return feed.items
      .map((item) => this.toRaw(item as FeedItem))
      .filter((item): item is RawMediaItem => item !== null)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, Math.max(0, limit));
  }

  private toRaw(item: FeedItem): RawMediaItem | null {
    const url = item.link?.trim();
    const title = item.title?.trim();
    const date = Date.parse(item.isoDate ?? item.pubDate ?? '');
    if (!url || !title || Number.isNaN(date)) return null;
    const html =
      item['content:encoded'] ?? item.content ?? item.contentSnippet ?? '';
    const text = html || (item.contentSnippet ?? '');
    const raw: RawMediaItem = {
      url,
      title,
      summary: normalizeSummary(text),
      content: normalizeContent(text),
      publishedAt: new Date(date).toISOString(),
      source: this.id,
    };
    const author = item.creator?.trim();
    if (author) raw.author = author;
    const imageUrl = FIRST_IMG_SRC.exec(html)?.[1];
    if (imageUrl) raw.imageUrl = imageUrl;
    return raw;
  }
}
