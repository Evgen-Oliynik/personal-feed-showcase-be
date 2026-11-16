export type MediaSourceId = 'devto' | 'medium' | 'youtube' | 'itunes';

export interface RawMediaItem {
  url: string;
  title: string;
  summary: string;
  /** Longer description (up to 2000 chars) for embeddings and chat. */
  content?: string;
  author?: string;
  imageUrl?: string;
  /** ISO 8601 timestamp. */
  publishedAt: string;
  durationSec?: number;
  enclosureMimeType?: string;
  source: MediaSourceId;
}

export interface MediaSource {
  id: MediaSourceId;
  enabled(): boolean;
  fetch(topic: string, limit: number): Promise<RawMediaItem[]>;
}
