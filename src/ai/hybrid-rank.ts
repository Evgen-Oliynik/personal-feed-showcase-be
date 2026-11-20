import type { DbHandle } from '../db/database.js';
import type { Embedder } from './embedder.js';

/** vec0 caps k at 4096. */
const MAX_KNN = 4096;
/** Reciprocal rank fusion constant. */
export const RRF_K = 60;

const STOPWORDS = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up us very was we were what when where which while who whom why will with would you your`.split(
    /\s+/,
  ),
);

export interface RankableItem {
  id: number;
}

/** Lowercased query words minus stopwords and 1-character words, each quoted, joined with OR. */
export function buildFtsQuery(query: string): string | undefined {
  const words =
    query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}#+]*/gu) ?? [];
  const terms = [
    ...new Set(words.filter((w) => w.length > 1 && !STOPWORDS.has(w))),
  ];
  if (terms.length === 0) return undefined;
  return terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' OR ');
}

/**
 * Fuses rankings of item ids: score = Σ 1 / (RRF_K + rank), rank from 1.
 * Ties break by dense distance, then by feed position.
 */
export function fuse<T extends RankableItem>(
  items: T[],
  rankings: number[][],
  distance: Map<number, number>,
): T[] {
  const score = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    });
  }
  return items
    .map((item, pos) => ({ item, pos }))
    .sort(
      (a, b) =>
        (score.get(b.item.id) ?? 0) - (score.get(a.item.id) ?? 0) ||
        (distance.get(a.item.id) ?? Infinity) -
          (distance.get(b.item.id) ?? Infinity) ||
        a.pos - b.pos,
    )
    .map((x) => x.item);
}

/**
 * Ranks feed items for a question: dense (cosine over the best chunk) and
 * lexical (FTS5 bm25 over the best chunk), fused with reciprocal rank fusion.
 */
export async function rankFeedItems<T extends RankableItem>(
  deps: { handle: DbHandle; embedder: Embedder },
  query: string,
  items: T[],
): Promise<T[]> {
  if (items.length === 0) return [];
  const { sqlite } = deps.handle;
  const ids = JSON.stringify(items.map((i) => i.id));

  const [vector] = await deps.embedder.embed([query], 'query');
  // KNN runs over every chunk, then is restricted to the items, so k must
  // cover the whole table or other items could crowd them out.
  const dense = sqlite
    .prepare(
      `SELECT c.media_item_id AS id, min(e.distance) AS distance
       FROM (SELECT chunk_id, distance FROM chunk_embeddings WHERE embedding MATCH ? AND k = ?) e
       JOIN item_chunks c ON c.id = e.chunk_id
       WHERE c.media_item_id IN (SELECT value FROM json_each(?))
       GROUP BY c.media_item_id ORDER BY distance`,
    )
    .all(new Float32Array(vector!), BigInt(MAX_KNN), ids) as {
    id: number | bigint;
    distance: number;
  }[];
  const distance = new Map(dense.map((r) => [Number(r.id), r.distance]));
  const rankings = [dense.map((r) => Number(r.id))];

  const match = buildFtsQuery(query);
  if (match) {
    // bm25() only works in a plain FTS query, so the join to items is done here.
    const owner = new Map(
      (
        sqlite
          .prepare(
            'SELECT id, media_item_id FROM item_chunks WHERE media_item_id IN (SELECT value FROM json_each(?))',
          )
          .all(ids) as { id: number | bigint; media_item_id: number | bigint }[]
      ).map((r) => [Number(r.id), Number(r.media_item_id)]),
    );
    const hits = sqlite
      .prepare(
        'SELECT rowid AS chunk_id FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY bm25(chunk_fts)',
      )
      .all(match) as { chunk_id: number | bigint }[];
    const lexical = new Set<number>();
    for (const h of hits) {
      const item = owner.get(Number(h.chunk_id));
      if (item !== undefined) lexical.add(item);
    }
    rankings.push([...lexical]);
  }
  return fuse(items, rankings, distance);
}
