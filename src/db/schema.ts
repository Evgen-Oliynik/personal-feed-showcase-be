import { sql } from 'drizzle-orm';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';

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
  firstSeenDate: text('first_seen_date').notNull(), // YYYY-MM-DD, set on insert only
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

/** Topics `FeedBuilder` fetched for a date: a topic is never fetched twice a day. */
export const feedTopicFetches = sqliteTable(
  'feed_topic_fetches',
  {
    feedDate: text('feed_date').notNull(), // YYYY-MM-DD
    topic: text('topic').notNull(),
  },
  (t) => [primaryKey({ columns: [t.feedDate, t.topic] })],
);

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
