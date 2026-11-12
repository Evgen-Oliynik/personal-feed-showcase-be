import { describe, expect, it } from 'vitest';
import { classify, normalizeSummary } from './classify.js';
import type { RawMediaItem } from './media-source.js';

const item = (over: Partial<RawMediaItem> = {}): RawMediaItem => ({
  url: 'https://example.com/a',
  title: 't',
  summary: 's',
  publishedAt: '2026-01-01T00:00:00Z',
  source: 'devto',
  ...over,
});

describe('classify', () => {
  it('audio mime → listen', () => {
    expect(classify(item({ enclosureMimeType: 'audio/mpeg' }))).toBe('listen');
  });
  it('video mime → watch', () => {
    expect(classify(item({ enclosureMimeType: 'video/mp4' }))).toBe('watch');
  });
  it('youtube source → watch', () => {
    expect(classify(item({ source: 'youtube' }))).toBe('watch');
  });
  it('youtube.com / youtu.be host → watch', () => {
    expect(classify(item({ url: 'https://www.youtube.com/watch?v=1' }))).toBe('watch');
    expect(classify(item({ url: 'https://youtu.be/1' }))).toBe('watch');
  });
  it('lookalike host is not youtube', () => {
    expect(classify(item({ url: 'https://notyoutube.com/x' }))).toBe('read');
  });
  it('itunes source → listen', () => {
    expect(classify(item({ source: 'itunes' }))).toBe('listen');
  });
  it('otherwise → read', () => {
    expect(classify(item())).toBe('read');
    expect(classify(item({ source: 'medium', enclosureMimeType: 'image/png' }))).toBe('read');
  });
  it('mime beats source and host', () => {
    expect(classify(item({ source: 'youtube', enclosureMimeType: 'audio/mp4' }))).toBe('listen');
    expect(classify(item({ source: 'itunes', enclosureMimeType: 'video/mp4' }))).toBe('watch');
  });
  it('youtube beats itunes', () => {
    expect(classify(item({ source: 'itunes', url: 'https://youtu.be/1' }))).toBe('watch');
  });
});

describe('normalizeSummary', () => {
  it('strips tags and entities and collapses whitespace', () => {
    expect(normalizeSummary('<p>Hello&nbsp; <b>big</b>\n\n world &amp; &#39;co&#x27;</p>')).toBe(
      "Hello big world & 'co'",
    );
  });
  it('leaves short text untouched', () => {
    expect(normalizeSummary('short')).toBe('short');
  });
  it('truncates to 300 chars at a word boundary with ellipsis', () => {
    const out = normalizeSummary('word '.repeat(100));
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.slice(0, -1).endsWith('word')).toBe(true);
  });
  it('never cuts mid-word', () => {
    const out = normalizeSummary(`${'a'.repeat(295)} bcdefghij klm`);
    expect(out).toBe(`${'a'.repeat(295)}…`);
  });
});
