CREATE VIRTUAL TABLE chunk_fts USING fts5(
  text,
  tokenize = "unicode61 tokenchars '#+'"
);
--> statement-breakpoint
INSERT INTO chunk_fts(rowid, text) SELECT id, text FROM item_chunks;
--> statement-breakpoint
CREATE TRIGGER item_chunks_fts_delete AFTER DELETE ON item_chunks BEGIN
  DELETE FROM chunk_fts WHERE rowid = old.id;
END;
