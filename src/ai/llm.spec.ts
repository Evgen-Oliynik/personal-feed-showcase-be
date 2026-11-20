import { OpenAiLlm } from './llm.js';

const create = vi.fn();

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const chunk = (content: string | null | undefined) => ({
  choices: [{ delta: { content } }],
});

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const t of it) out.push(t);
  return out;
}

describe('OpenAiLlm', () => {
  const options = { apiKey: 'k', model: 'm', maxTokens: 99 };

  beforeEach(() => create.mockReset());

  it('sends the request shape and yields deltas in order, skipping empty ones', async () => {
    create.mockResolvedValue(
      (async function* () {
        yield chunk('Hel');
        yield chunk('');
        yield chunk(null);
        yield chunk(undefined);
        yield chunk('lo');
      })(),
    );
    const parts = await collect(
      new OpenAiLlm(options).stream('sys', [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'usr' },
      ]),
    );
    expect(parts).toEqual(['Hel', 'lo']);
    expect(parts.join('')).toBe('Hello');
    expect(create).toHaveBeenCalledWith({
      model: 'm',
      max_completion_tokens: 99,
      stream: true,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'usr' },
      ],
    });
  });

  it('throws when the API key is missing', async () => {
    const llm = new OpenAiLlm({ ...options, apiKey: undefined });
    await expect(
      collect(llm.stream('s', [{ role: 'user', content: 'u' }])),
    ).rejects.toThrow('OPENAI_API_KEY is not set');
    expect(create).not.toHaveBeenCalled();
  });
});
