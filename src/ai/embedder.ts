import { createHash } from 'node:crypto';

export const EMBEDDING_DIMENSIONS = 384;
export const EMBED_BATCH_SIZE = 32;
export const EMBEDDER = Symbol('EMBEDDER');

export type EmbedKind = 'query' | 'passage';

/** bge-small-en-v1.5 retrieval prefix; passages get none. */
export const QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

export interface Embedder {
  /** One L2-normalized, 384-dimension vector per text, in input order. */
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

type Extractor = (
  texts: string[],
  options: { pooling: 'cls'; normalize: true },
) => Promise<{ tolist(): number[][] }>;

/** Runs the sentence-embedding model in-process; no API key, no external service. */
export class LocalEmbedder implements Embedder {
  private extractor: Promise<Extractor> | undefined;

  constructor(
    private readonly model: string,
    private readonly cacheDir = './data/models',
  ) {}

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (kind === 'query') texts = texts.map((t) => QUERY_PREFIX + t);
    const extract = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const tensor = await extract(texts.slice(i, i + EMBED_BATCH_SIZE), {
        pooling: 'cls',
        normalize: true,
      });
      out.push(...tensor.tolist());
    }
    return out;
  }

  /** Loads once; concurrent first calls share the same promise. */
  private load(): Promise<Extractor> {
    this.extractor ??= (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = this.cacheDir;
      return (await pipeline(
        'feature-extraction',
        this.model,
      )) as unknown as Extractor;
    })().catch((err: unknown) => {
      this.extractor = undefined; // let the next call retry
      throw err;
    });
    return this.extractor;
  }
}

/** Deterministic bag-of-words vectors: texts sharing words are closer. */
export class FakeEmbedder implements Embedder {
  embed(texts: string[], _kind: EmbedKind = 'passage'): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => this.vector(t)));
  }

  private vector(text: string): number[] {
    const v = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      const h = createHash('sha256').update(word).digest();
      v[h.readUInt32BE(0) % EMBEDDING_DIMENSIONS]! += 1;
    }
    const norm = Math.hypot(...v);
    if (norm === 0) v[0] = 1;
    return norm === 0 ? v : v.map((x) => x / norm);
  }
}
