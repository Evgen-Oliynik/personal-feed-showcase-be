import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { YoutubeSource, parseIsoDuration } from './youtube.source.js';

const fixture = readFileSync(
  new URL('../../test/fixtures/youtube-search.json', import.meta.url),
  'utf8',
);

const videos = readFileSync(
  new URL('../../test/fixtures/youtube-videos.json', import.meta.url),
  'utf8',
);

/** search.list gets the search fixture, videos.list gets `videosRes`. */
function stubBoth(videosRes: () => Promise<Response>) {
  const fn = vi.fn((url: string) =>
    url.includes('/youtube/v3/videos')
      ? videosRes()
      : Promise.resolve(new Response(fixture, { status: 200 })),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

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
      content: 'A tour of "new" features.',
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

  it('fills content and duration from one batched videos.list call', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const f = stubBoth(async () => new Response(videos, { status: 200 }));
    const items = await source('KEY').fetch('react', 10);
    expect(f).toHaveBeenCalledTimes(2);
    const url = new URL(String(f.mock.calls[1]?.[0] as unknown));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      part: 'snippet,contentDetails',
      id: 'abc123,def456',
      key: 'KEY',
    });
    expect(items[0]?.content).toBe(
      'A tour of "new" features. Chapters: 0:00 Intro & goals 1:00 Server components',
    );
    expect(items[0]?.summary).toBe('A tour of "new" features.');
    expect(items[0]?.durationSec).toBe(3723);
    // def456 is omitted by videos.list: snippet fallback, no duration.
    expect(items[1]?.content).toBe('');
    expect(items[1]?.durationSec).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'youtube videos.list omitted 1 of 2 videos',
    );
  });

  it('does not warn when videos.list returns every requested id', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const all = JSON.stringify({
      items: [
        { id: 'abc123', snippet: { description: 'a' } },
        { id: 'def456', snippet: { description: 'b' } },
      ],
    });
    stubBoth(async () => new Response(all, { status: 200 }));
    await source('KEY').fetch('react', 10);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to search data and warns once when videos.list fails', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    stubBoth(async () => new Response('{}', { status: 403 }));
    const items = await source('k').fetch('react', 10);
    expect(items).toHaveLength(2);
    expect(items[0]?.content).toBe('A tour of "new" features.');
    expect(items[0]?.durationSec).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('parseIsoDuration', () => {
  it('parses ISO 8601 durations', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT10M')).toBe(600);
    expect(parseIsoDuration('P1DT1H')).toBe(90000);
    expect(parseIsoDuration('P0D')).toBe(0);
    expect(parseIsoDuration('nope')).toBeUndefined();
    expect(parseIsoDuration(undefined)).toBeUndefined();
  });
});
