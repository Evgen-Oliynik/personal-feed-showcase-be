import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('Feed (e2e)', () => {
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

  const get = (topics: string) =>
    request(app.getHttpServer()).get('/feed/today').query({ topics });

  it('returns an empty feed with no topics', async () => {
    for (const req of [
      request(app.getHttpServer()).get('/feed/today'),
      get(''),
    ]) {
      const res = await req.expect(200);
      expect(res.body).toMatchObject({
        items: [],
        counts: { read: 0, watch: 0, listen: 0 },
        reason: 'no-topics',
      });
      expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.body).not.toHaveProperty('builtAt');
    }
  });

  it('gives different feeds for different lists, unaffected by other lists', async () => {
    const a = await get('react,rust').expect(200);
    const b = await get('go,python').expect(200);
    const urls = (body: { items: { url: string }[] }) =>
      body.items.map((i) => i.url);
    expect(urls(a.body)).not.toEqual(urls(b.body));
    expect(
      new Set(a.body.items.map((i: { topic: string }) => i.topic)),
    ).toEqual(new Set(['react', 'rust']));
    expect(
      new Set(b.body.items.map((i: { topic: string }) => i.topic)),
    ).toEqual(new Set(['go', 'python']));
    const again = await get('react,rust').expect(200);
    expect(again.body).toEqual(a.body);
  });

  it('serves at most 10 per type and identical items for the same list', async () => {
    const [a, b] = await Promise.all([
      get('react,rust').expect(200),
      get('react,rust').expect(200),
    ]);
    expect(a.body.limits).toEqual({ read: 10, watch: 10, listen: 10 });
    expect(a.body.counts).toEqual({ read: 10, watch: 10, listen: 10 });
    expect(a.body.items).toHaveLength(30);
    expect(a.body.reason).toBeUndefined();
    expect(b.body).toEqual(a.body);
  });

  it('400 for 11 topics or an invalid name', async () => {
    await get(Array.from({ length: 11 }, (_, i) => `t${i}`).join(',')).expect(
      400,
    );
    await get('react,-bad').expect(400);
  });
});
