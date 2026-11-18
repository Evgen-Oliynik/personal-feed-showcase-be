import OpenAI from 'openai';

export const LLM = Symbol('LLM');

export interface Llm {
  stream(system: string, user: string): AsyncIterable<string>;
}

export interface OpenAiLlmOptions {
  apiKey: string | undefined;
  model: string;
  maxTokens: number;
}

export class OpenAiLlm implements Llm {
  private client: OpenAI | undefined;

  constructor(private readonly options: OpenAiLlmOptions) {}

  async *stream(system: string, user: string): AsyncIterable<string> {
    const { apiKey, model, maxTokens } = this.options;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    this.client ??= new OpenAI({ apiKey });
    const chunks = await this.client.chat.completions.create({
      model,
      // max_completion_tokens also bounds reasoning tokens
      max_completion_tokens: maxTokens,
      stream: true,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    for await (const chunk of chunks) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
  }
}

/** Deterministic answer for `FAKE_EXTERNALS=1`; always cites `[1]`. */
export class FakeLlm implements Llm {
  async *stream(): AsyncIterable<string> {
    await Promise.resolve();
    for (const part of [
      'According to the collected materials',
      ', here is the answer',
      ' [1].',
    ]) {
      yield part;
    }
  }
}
