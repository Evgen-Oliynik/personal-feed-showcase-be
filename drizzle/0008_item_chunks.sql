DROP TABLE item_embeddings;
--> statement-breakpoint
CREATE TABLE item_chunks (
  id integer PRIMARY KEY,
  media_item_id integer NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  text text NOT NULL
);
--> statement-breakpoint
CREATE INDEX item_chunks_media_item_id_idx ON item_chunks(media_item_id);
--> statement-breakpoint
CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  chunk_id integer primary key,
  embedding float[384] distance_metric=cosine
);
