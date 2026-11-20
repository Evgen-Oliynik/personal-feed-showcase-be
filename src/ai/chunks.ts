export const CHUNK_MAX_CHARS = 800;
export const CHUNK_MAX_COUNT = 3;

export interface ChunkableItem {
  title: string;
  summary: string;
  content: string | null;
}

/** Index of the last sentence end in `window` past its first half, or -1. */
function sentenceCut(window: string): number {
  let cut = -1;
  for (const m of window.matchAll(/[.!?]["')\]]*\s/g)) {
    const end = m.index + m[0].length;
    if (end > CHUNK_MAX_CHARS / 2) cut = end;
  }
  return cut;
}

/**
 * Splits `content ?? summary` into at most 3 chunks of at most 800 characters,
 * cutting at a sentence end, else at a word boundary. An item with no text
 * yields one chunk of its title.
 */
export function chunkItem(item: ChunkableItem): string[] {
  let rest = (item.content ?? item.summary).trim();
  if (rest === '') return [item.title];
  const chunks: string[] = [];
  while (rest !== '' && chunks.length < CHUNK_MAX_COUNT) {
    if (rest.length <= CHUNK_MAX_CHARS) {
      chunks.push(rest);
      break;
    }
    const window = rest.slice(0, CHUNK_MAX_CHARS + 1);
    let cut = sentenceCut(window.slice(0, CHUNK_MAX_CHARS));
    if (cut === -1) cut = window.search(/\s\S*$/);
    if (cut <= 0) cut = CHUNK_MAX_CHARS;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return chunks;
}
