import type { RawMediaItem } from './media-source.js';

export type MediaKind = 'read' | 'watch' | 'listen';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtu.be']);
const SUMMARY_MAX = 300;

function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '');
    return YOUTUBE_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function classify(item: RawMediaItem): MediaKind {
  const mime = item.enclosureMimeType?.toLowerCase();
  if (mime?.startsWith('audio/')) return 'listen';
  if (mime?.startsWith('video/')) return 'watch';
  if (item.source === 'youtube' || isYoutubeUrl(item.url)) return 'watch';
  if (item.source === 'itunes') return 'listen';
  return 'read';
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function normalizeSummary(html: string): string {
  const text = decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= SUMMARY_MAX) return text;
  const cut = text.slice(0, SUMMARY_MAX);
  // Cut at a word boundary: drop the partial word unless the cut landed on one.
  const atBoundary = /\s/.test(text[SUMMARY_MAX] ?? '');
  const base = atBoundary ? cut : cut.replace(/\s+\S*$/, '');
  return `${(base || cut).trimEnd()}…`;
}
