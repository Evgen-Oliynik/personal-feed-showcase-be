import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateConfig } from '../config/config.js';
import type { MediaSource } from './media-source.js';
import { SOURCES, SourcesModule } from './sources.module.js';

async function sourcesFor(env: Record<string, string>): Promise<MediaSource[]> {
  const mod = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        validate: () => validateConfig(env),
      }),
      SourcesModule,
    ],
  }).compile();
  return mod.get<MediaSource[]>(SOURCES);
}

describe('SourcesModule', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // ConfigModule copies validated values into process.env; don't leak the key.
    delete process.env.YOUTUBE_API_KEY;
  });

  it('warns once for a disabled youtube source, and not when keyed', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    await sourcesFor({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'youtube disabled: YOUTUBE_API_KEY is not set',
    );

    warn.mockClear();
    await sourcesFor({ YOUTUBE_API_KEY: 'k' });
    await sourcesFor({ FAKE_EXTERNALS: '1' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('wires the real sources by default (youtube only with a key)', async () => {
    const sources = await sourcesFor({});
    expect(sources.map((s) => s.id)).toEqual(['devto', 'medium', 'itunes']);
    expect(sources[0].constructor.name).toBe('DevtoSource');

    const withKey = await sourcesFor({ YOUTUBE_API_KEY: 'k' });
    expect(withKey.map((s) => s.id)).toEqual([
      'devto',
      'medium',
      'youtube',
      'itunes',
    ]);
  });

  it('wires deterministic fixture sources when FAKE_EXTERNALS=1', async () => {
    const sources = await sourcesFor({ FAKE_EXTERNALS: '1' });
    expect(sources.map((s) => s.id)).toEqual(['devto', 'youtube', 'itunes']);
    expect(sources[0].constructor.name).toBe('FixtureSource');

    for (const s of sources) {
      const a = await s.fetch('ai', 50);
      expect(a).toHaveLength(15);
      expect(await s.fetch('ai', 50)).toEqual(a);
      expect(a[0].url).toBe(`https://example.test/${s.id}/ai/1`);
      expect(a[0].publishedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(a[1].publishedAt).toBe('2025-12-31T23:00:00.000Z');
      const other = await s.fetch('rust', 50);
      const urls = new Set([...a, ...other].map((i) => i.url));
      expect(urls.size).toBe(30);
    }
  });
});
