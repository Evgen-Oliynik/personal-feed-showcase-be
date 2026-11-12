import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevtoSource } from './devto.source.js';
import { MediumSource } from './medium.source.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8');

function stubFetch(impl: (url: string) => Promise<Response>) {
  const fn = vi.fn((url: string) => impl(url));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DevtoSource', () => {
  it('maps the fixture, newest first, with image and cleaned summary', async () => {
    const f = stubFetch(
      async () => new Response(fixture('devto-react.xml'), { status: 200 }),
    );
    const items = await new DevtoSource().fetch('React', 10);
    expect(f.mock.calls[0]?.[0]).toBe('https://dev.to/feed/tag/React');
    expect(items.map((i) => i.title)).toEqual([
      'Newest React tips',
      'Middle post',
      'Older & wiser hooks',
    ]);
    expect(items[0]).toMatchObject({
      url: 'https://dev.to/bob/newest-react-tips-2',
      author: 'Bob',
      imageUrl: 'https://media.dev.to/cover.png',
      summary: 'Ten tips for React.',
      publishedAt: '2026-11-11T09:30:00.000Z',
      source: 'devto',
    });
    expect(items[1]?.imageUrl).toBeUndefined();
    expect(items[2]?.summary).toBe('Hooks & state, explained.');
  });

  it('respects limit', async () => {
    stubFetch(
      async () => new Response(fixture('devto-react.xml'), { status: 200 }),
    );
    expect(await new DevtoSource().fetch('react', 2)).toHaveLength(2);
  });

  it('removes spaces and URL-encodes the tag', async () => {
    const f = stubFetch(
      async () => new Response(fixture('devto-react.xml'), { status: 200 }),
    );
    await new DevtoSource().fetch('machine learning é', 1);
    expect(f.mock.calls[0]?.[0]).toBe(
      'https://dev.to/feed/tag/machinelearning%C3%A9',
    );
  });
});

describe('MediumSource', () => {
  it('maps content:encoded, newest first', async () => {
    const f = stubFetch(
      async () => new Response(fixture('medium-react.xml'), { status: 200 }),
    );
    const items = await new MediumSource().fetch('react', 10);
    expect(f.mock.calls[0]?.[0]).toBe('https://medium.com/feed/tag/react');
    expect(items.map((i) => i.title)).toEqual([
      'No image here',
      'Server Components in practice',
    ]);
    expect(items[0]?.imageUrl).toBeUndefined();
    expect(items[1]).toMatchObject({
      imageUrl: 'https://cdn-images-1.medium.com/max/1024/a.jpg',
      summary: 'How server components change everything.',
      author: 'Dave',
      source: 'medium',
    });
  });
});

describe('failures return [] and warn once', () => {
  const cases: [string, () => Promise<Response>][] = [
    ['network error', async () => Promise.reject(new Error('ECONNRESET'))],
    [
      'timeout',
      async () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
    ],
    ['non-200', async () => new Response('nope', { status: 503 })],
    ['malformed xml', async () => new Response('not xml', { status: 200 })],
  ];
  it.each(cases)('%s', async (_name, impl) => {
    stubFetch(impl);
    const source = new MediumSource();
    const warn = vi.fn();
    (source as unknown as { logger: { warn: unknown } }).logger.warn = warn;
    expect(await source.fetch('react', 5)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String((warn.mock.calls[0] as unknown[])[0])).toContain('medium');
    expect(String((warn.mock.calls[0] as unknown[])[0])).toContain('react');
  });
});
