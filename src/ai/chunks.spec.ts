import { describe, expect, it } from 'vitest';
import { chunkItem } from './chunks.js';

const item = (content: string | null, summary = '') => ({
  title: 'T',
  summary,
  content,
});

describe('chunkItem', () => {
  it('keeps short text as one chunk, preferring content over summary', () => {
    expect(chunkItem(item('Short body.', 'sum'))).toEqual(['Short body.']);
    expect(chunkItem(item(null, 'only summary'))).toEqual(['only summary']);
  });

  it('cuts at a sentence end within 800 characters', () => {
    const s1 = `${'a'.repeat(500)}. `;
    const s2 = 'b'.repeat(500);
    const out = chunkItem(item(s1 + s2));
    expect(out).toEqual([`${'a'.repeat(500)}.`, s2]);
  });

  it('falls back to a word boundary, and never exceeds 800 characters', () => {
    const words = Array.from({ length: 300 }, () => 'word').join(' ');
    const out = chunkItem(item(words));
    for (const c of out) {
      expect(c.length).toBeLessThanOrEqual(800);
      expect(c.endsWith('word')).toBe(true);
    }
    expect(out.length).toBeGreaterThan(1);
  });

  it('hard-cuts a single word longer than 800 characters', () => {
    const out = chunkItem(item('x'.repeat(1000)));
    expect(out[0]).toHaveLength(800);
    expect(out[1]).toHaveLength(200);
  });

  it('caps at 3 chunks', () => {
    expect(chunkItem(item('word '.repeat(2000)))).toHaveLength(3);
  });

  it('yields the title for an item with neither content nor summary', () => {
    expect(chunkItem(item(null, ''))).toEqual(['T']);
    expect(chunkItem(item('  ', ' '))).toEqual(['T']);
  });
});
