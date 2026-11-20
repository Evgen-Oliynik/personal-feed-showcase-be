import { beforeEach, describe, expect, it, vi } from 'vitest';

const extract = vi.fn(async (texts: string[]) => ({
  tolist: () => texts.map(() => [1, 0, 0]),
}));
const pipeline = vi.fn(async () => extract);
const env: { cacheDir?: string } = {};
vi.mock('@huggingface/transformers', () => ({ pipeline, env }));

const { LocalEmbedder, FakeEmbedder, EMBEDDING_DIMENSIONS } =
  await import('./embedder.js');

describe('LocalEmbedder', () => {
  beforeEach(() => {
    extract.mockClear();
    pipeline.mockClear();
  });

  it('batches by 32 and returns one vector per text, in order', async () => {
    const e = new LocalEmbedder('m');
    const out = await e.embed(
      Array.from({ length: 70 }, (_, i) => `t${i}`),
      'passage',
    );
    expect(out).toHaveLength(70);
    expect(extract.mock.calls.map((c) => c[0].length)).toEqual([32, 32, 6]);
    expect(extract).toHaveBeenCalledWith(expect.any(Array), {
      pooling: 'cls',
      normalize: true,
    });
  });

  it('prefixes queries and leaves passages as they are', async () => {
    const e = new LocalEmbedder('m');
    await e.embed(['what is bun'], 'query');
    await e.embed(['Bun is a runtime'], 'passage');
    expect(extract.mock.calls[0]![0]).toEqual([
      'Represent this sentence for searching relevant passages: what is bun',
    ]);
    expect(extract.mock.calls[1]![0]).toEqual(['Bun is a runtime']);
  });

  it('loads the model once for concurrent first calls', async () => {
    const e = new LocalEmbedder('some/model', './cache');
    await Promise.all([e.embed(['a'], 'passage'), e.embed(['b'], 'passage')]);
    await e.embed(['c'], 'passage');
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenCalledWith('feature-extraction', 'some/model');
    expect(env.cacheDir).toBe('./cache');
  });
});

describe('FakeEmbedder', () => {
  const cos = (a: number[], b: number[]) =>
    a.reduce((s, x, i) => s + x * b[i]!, 0);

  it('returns deterministic normalized 384-d vectors; shared words are closer', async () => {
    const f = new FakeEmbedder();
    const [a, b, c] = await f.embed(
      ['rust async runtime', 'rust async tokio', 'banana smoothie recipe'],
      'query',
    );
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.hypot(...a!)).toBeCloseTo(1);
    expect((await f.embed(['rust async runtime'], 'passage'))[0]).toEqual(a);
    expect(cos(a!, b!)).toBeGreaterThan(cos(a!, c!));
  });
});
