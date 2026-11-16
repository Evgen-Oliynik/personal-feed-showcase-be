import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItunesSource } from './itunes.source.js';

const fixture = readFileSync(
  new URL('../../test/fixtures/itunes-search.json', import.meta.url),
  'utf8',
);

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn((_url: string) => impl());
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ItunesSource', () => {
  it('calls the search endpoint with the expected params', async () => {
    const f = stubFetch(async () => new Response(fixture, { status: 200 }));
    await new ItunesSource().fetch('react hooks', 5);
    const url = new URL(String(f.mock.calls[0]?.[0] as unknown));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      media: 'podcast',
      entity: 'podcastEpisode',
      term: 'react hooks',
      limit: '50',
    });
  });

  it('maps fixture results to RawMediaItem, skipping incomplete ones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    stubFetch(async () => new Response(fixture, { status: 200 }));
    const items = await new ItunesSource().fetch('react', 5);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      url: 'https://podcasts.apple.com/us/podcast/understanding-react-hooks/id111?i=1000',
      title: 'Understanding React Hooks',
      summary: expect.stringContaining('hooks & effects'),
      content: 'We dig into hooks & effects.',
      author: 'The Frontend Show',
      imageUrl: 'https://example.com/art600.jpg',
      publishedAt: '2026-11-10T08:00:00.000Z',
      durationSec: 1800,
      enclosureMimeType: 'audio/mpeg',
      source: 'itunes',
    });
    expect(items[1]?.enclosureMimeType).toBe('video/mp4');
    expect(items[1]?.durationSec).toBeUndefined();
  });

  it('caps the result at limit, newest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    stubFetch(async () => new Response(fixture, { status: 200 }));
    const items = await new ItunesSource().fetch('react', 1);
    expect(items.map((i) => i.title)).toEqual(['Understanding React Hooks']);
  });

  it('returns [] and warns on non-200', async () => {
    stubFetch(async () => new Response('', { status: 500 }));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    expect(await new ItunesSource().fetch('x', 5)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns [] and warns when fetch throws', async () => {
    stubFetch(async () => {
      throw new Error('boom');
    });
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    expect(await new ItunesSource().fetch('x', 5)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
