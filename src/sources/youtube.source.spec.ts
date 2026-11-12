import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YoutubeSource } from './youtube.source.js';

const fixture = readFileSync(
  new URL('../../test/fixtures/youtube-search.json', import.meta.url),
  'utf8',
);

const source = (key?: string) =>
  new YoutubeSource({
    get: () => key,
  } as unknown as ConfigService<never, true>);

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn((_url: string) => impl());
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('YoutubeSource', () => {
  it('is enabled only with an API key', () => {
    expect(source().enabled()).toBe(false);
    expect(source('k').enabled()).toBe(true);
  });

  it('calls search.list with the expected params', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    const f = stubFetch(async () => new Response(fixture, { status: 200 }));
    await source('KEY').fetch('react hooks', 5);
    const url = new URL(String(f.mock.calls[0]?.[0] as unknown));
    expect(url.origin + url.pathname).toBe(
      'https://www.googleapis.com/youtube/v3/search',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      part: 'snippet',
      type: 'video',
      order: 'date',
      maxResults: '5',
      q: 'react hooks',
      publishedAfter: '2026-11-05T00:00:00.000Z',
      key: 'KEY',
    });
  });

  it('maps the fixture, skipping non-video results', async () => {
    stubFetch(async () => new Response(fixture, { status: 200 }));
    const items = await source('k').fetch('react', 10);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      url: 'https://www.youtube.com/watch?v=abc123',
      title: "React & Next.js: what's new",
      summary: 'A tour of "new" features.',
      author: 'Code & Coffee',
      imageUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      publishedAt: '2026-11-10T12:00:00.000Z',
      source: 'youtube',
    });
    expect(items[1]?.imageUrl).toBeUndefined();
  });

  it('returns [] on quota errors, network errors and bad bodies', async () => {
    for (const impl of [
      async () => new Response('{"error":{}}', { status: 403 }),
      async () => {
        throw new Error('down');
      },
      async () => new Response('not json', { status: 200 }),
    ]) {
      stubFetch(impl);
      expect(await source('k').fetch('react', 5)).toEqual([]);
    }
  });

  it('makes no request without a key', async () => {
    const f = stubFetch(async () => new Response(fixture));
    expect(await source().fetch('react', 5)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
