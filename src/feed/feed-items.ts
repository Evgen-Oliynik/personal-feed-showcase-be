import type { mediaItems } from '../db/schema.js';

export const PER_SOURCE_LIMIT = 15;
export const PER_TYPE_CAP = 10;

/** Lowercased, punctuation and emoji removed, whitespace collapsed. */
export const normalizeTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

export type MediaItemRow = typeof mediaItems.$inferSelect;
