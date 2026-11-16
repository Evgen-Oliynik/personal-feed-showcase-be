import Anthropic from '@anthropic-ai/sdk';

export const LLM = Symbol('LLM');
export const LLM_MODEL = 'claude-sonnet-5-5';
export const LLM_MAX_TOKENS = 1024;

export interface Llm {
  stream(system: string, user: string): AsyncIterable<string>;
}

export class AnthropicLlm implements Llm {
  private client: Anthropic | undefined;

  constructor(private readonly apiKey: string | undefined) {}

  async *stream(system: string, user: string): AsyncIterable<string> {
    if (!this.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    const events = this.client.messages.stream({
      model: LLM_MODEL,
      max_tokens: LLM_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    });
    for await (const event of events) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
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
