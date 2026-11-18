import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const MEDIA_TYPES = ['read', 'watch', 'listen'] as const;
export const MEDIA_SOURCES = ['devto', 'medium', 'youtube', 'itunes'] as const;

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
  firstSeenDate: text('first_seen_date').notNull(), // YYYY-MM-DD, set on insert only
});

/** Sources that answered for a topic on a date: a source is not fetched again that day. */
export const topicFetches = sqliteTable(
  'topic_fetches',
  {
    topic: text('topic').notNull(),
    fetchDate: text('fetch_date').notNull(), // YYYY-MM-DD
    source: text('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.topic, t.fetchDate, t.source] })],
);

/** The pool of a topic for a date. */
export const topicItems = sqliteTable(
  'topic_items',
  {
    topic: text('topic').notNull(),
    fetchDate: text('fetch_date').notNull(), // YYYY-MM-DD
    mediaItemId: integer('media_item_id')
      .notNull()
      .references(() => mediaItems.id),
  },
  (t) => [primaryKey({ columns: [t.topic, t.fetchDate, t.mediaItemId] })],
);

export const topicRequests = sqliteTable('topic_requests', {
  topic: text('topic').primaryKey(),
  lastRequestedDate: text('last_requested_date').notNull(), // YYYY-MM-DD
});
