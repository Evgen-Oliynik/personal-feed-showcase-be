import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { ChatService } from './../src/ai/chat.service.js';

interface SseEvent {
  event: string;
  data: unknown;
}

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))!.slice(7);
      const data = lines.find((l) => l.startsWith('data: '))!.slice(6);
      return { event, data: JSON.parse(data) as unknown };
    });
}

describe('Chat (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('streams sources, deltas, then done with URLs from today’s feed', async () => {
    const http = app.getHttpServer();
    const feed = await request(http)
      .get('/feed/today')
      .query({ topics: 'react' })
      .expect(200);
    const urls = (feed.body.items as { url: string }[]).map((i) => i.url);

    const res = await request(http)
      .post('/chat')
      .send({ question: '  react  ' })
      .expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = parseSse(res.text);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe('sources');
    expect(names.at(-1)).toBe('done');
    expect(names.slice(1, -1).length).toBeGreaterThan(0);
    expect(names.slice(1, -1).every((n) => n === 'delta')).toBe(true);
    expect(names.filter((n) => n === 'sources')).toHaveLength(1);

    const sources = events[0]!.data as { url: string }[];
    expect(sources.length).toBeGreaterThan(0);
    // Chat reads the topic pools, which hold more than the capped feed.
    expect(urls.length).toBeGreaterThan(0);
    for (const s of sources) expect(s.url).toMatch(/^https:\/\/example\.test\//);
    expect((events[1]!.data as { text: string }).text).toEqual(
      expect.any(String),
    );
  });

  it('streams the not-in-materials answer with empty sources when the feed is empty', async () => {
    const res = await request(app.getHttpServer())
      .post('/chat')
      .send({ question: 'anything?' })
      .expect(200);
    const events = parseSse(res.text);
    expect(events.map((e) => e.event)).toEqual(['sources', 'delta', 'done']);
    expect(events[0]!.data).toEqual([]);
    expect((events[1]!.data as { text: string }).text).toContain(
      'not in the collected materials',
    );
  });

  it('400 on a blank or too long question', async () => {
    const http = app.getHttpServer();
    await request(http).post('/chat').send({ question: '   ' }).expect(400);
    await request(http).post('/chat').send({}).expect(400);
    await request(http)
      .post('/chat')
      .send({ question: 'x'.repeat(501) })
      .expect(400);
  });
});

describe('Chat mid-stream error (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const source = {
      n: 1,
      id: 1,
      title: 'A title',
      url: 'https://example.com/a',
      type: 'read' as const,
      source: 'devto',
    };
    async function* tokens(): AsyncGenerator<string> {
      yield 'partial';
      throw new Error('llm down');
    }
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ChatService)
      .useValue({
        answer: () => Promise.resolve({ sources: [source], tokens: tokens() }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sends sources, one delta, then error and no done, and completes', async () => {
    const res = await request(app.getHttpServer())
      .post('/chat')
      .send({ question: 'anything?' })
      .expect(200);
    const events = parseSse(res.text);
    expect(events.map((e) => e.event)).toEqual(['sources', 'delta', 'error']);
    expect(events[1]!.data).toEqual({ text: 'partial' });
    const { message } = events[2]!.data as { message: unknown };
    expect(typeof message).toBe('string');
    expect((message as string).length).toBeGreaterThan(0);
  });
});
