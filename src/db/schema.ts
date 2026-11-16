import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const MEDIA_TYPES = ['read', 'watch', 'listen'] as const;
export const MEDIA_SOURCES = ['devto', 'medium', 'youtube', 'itunes'] as const;

export const topics = sqliteTable('topics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const mediaItems = sqliteTable('media_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  url: text('url').notNull().unique(),
  type: text('type', { enum: MEDIA_TYPES }).notNull(),
  source: text('source', { enum: MEDIA_SOURCES }).notNull(),
  topic: text('topic').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  content: text('content'),
  author: text('author'),
  imageUrl: text('image_url'),
  publishedAt: text('published_at').notNull(),
  durationSec: integer('duration_sec'),
  fetchedAt: text('fetched_at').notNull(),
});

export const feedEntries = sqliteTable(
  'feed_entries',
  {
    feedDate: text('feed_date').notNull(), // YYYY-MM-DD
    mediaItemId: integer('media_item_id')
      .notNull()
      .references(() => mediaItems.id),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.feedDate, t.mediaItemId)],
);

export const feeds = sqliteTable('feeds', {
  feedDate: text('feed_date').primaryKey(), // YYYY-MM-DD
  builtAt: text('built_at').notNull(),
});
