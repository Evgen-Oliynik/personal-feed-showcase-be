import type { MediaSource } from '../media-source.js';
import { FixtureSource } from './fixture-source.js';

export function createFixtureSources(): MediaSource[] {
  return [
    new FixtureSource({ id: 'devto', noun: 'article' }),
    new FixtureSource({
      id: 'youtube',
      noun: 'video',
      extra: { durationSec: 600 },
    }),
    new FixtureSource({
      id: 'itunes',
      noun: 'episode',
      extra: { durationSec: 1800, enclosureMimeType: 'audio/mpeg' },
    }),
  ];
}
