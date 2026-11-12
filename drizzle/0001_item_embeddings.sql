CREATE VIRTUAL TABLE item_embeddings USING vec0(
  media_item_id integer primary key,
  embedding float[1024]
);
