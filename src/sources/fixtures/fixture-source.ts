import type {
  MediaSource,
  MediaSourceId,
  RawMediaItem,
} from '../media-source.js';

const COUNT = 15;
const HOUR_MS = 60 * 60 * 1000;
/** Fixed anchor so fixture output is deterministic. */
const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z');

export interface FixtureShape {
  id: MediaSourceId;
  noun: string;
  extra?: Partial<RawMediaItem>;
}

export class FixtureSource implements MediaSource {
  readonly id: MediaSourceId;

  constructor(private readonly shape: FixtureShape) {
    this.id = shape.id;
  }

  enabled(): boolean {
    return true;
  }

  fetch(topic: string, limit: number = COUNT): Promise<RawMediaItem[]> {
    const { id, noun, extra } = this.shape;
    const items: RawMediaItem[] = [];
    for (let n = 1; n <= COUNT; n++) {
      items.push({
        url: `https://example.test/${id}/${encodeURIComponent(topic)}/${n}`,
        title: `${topic} ${noun} ${n}`,
        summary: `A fixture ${noun} about ${topic}, number ${n}.`,
        author: `${id} fixture author`,
        publishedAt: new Date(BASE_TIME - (n - 1) * HOUR_MS).toISOString(),
        source: id,
        ...extra,
      });
    }
    return Promise.resolve(items.slice(0, Math.max(0, limit)));
  }
}
