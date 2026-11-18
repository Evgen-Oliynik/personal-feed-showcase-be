import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('Topics (e2e)', () => {
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

  it('adds, lists, suggests and removes a topic', async () => {
    const http = app.getHttpServer();
    const created = await request(http)
      .post('/topics')
      .send({ name: '  React ' })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'react' });

    const list = await request(http).get('/topics').expect(200);
    expect(list.body).toEqual([created.body]);

    const sugg = await request(http).get('/topics/suggestions').expect(200);
    expect(sugg.body).not.toContain('react');
    expect(sugg.body.length).toBeGreaterThanOrEqual(11);

    await request(http).delete(`/topics/${created.body.id}`).expect(204);
    await request(http).delete(`/topics/${created.body.id}`).expect(404);
  });

  it('409 on duplicate, 400 on invalid name', async () => {
    const http = app.getHttpServer();
    await request(http).post('/topics').send({ name: 'rust' }).expect(201);
    await request(http).post('/topics').send({ name: 'Rust' }).expect(409);
    await request(http).post('/topics').send({ name: '-bad' }).expect(400);
  });

  it('PUT replaces the set and the feed follows', async () => {
    const http = app.getHttpServer();
    const put = await request(http)
      .put('/topics')
      .send({ names: ['React', ' rust ', 'react'] })
      .expect(200);
    expect(put.body.map((t: { name: string }) => t.name)).toEqual([
      'react',
      'rust',
    ]);
    const first = await request(http).get('/feed/today').expect(200);
    const topicsOf = (b: { items: { topic: string }[] }) =>
      new Set(b.items.map((i) => i.topic));
    expect(topicsOf(first.body)).toEqual(new Set(['react', 'rust']));

    const second = await request(http)
      .put('/topics')
      .send({ names: ['react', 'go'] })
      .expect(200);
    expect(second.body[0]).toEqual(put.body[0]);
    const feed = await request(http).get('/feed/today').expect(200);
    expect(topicsOf(feed.body).has('rust')).toBe(false);
    expect(topicsOf(feed.body).has('go')).toBe(true);
    for (const type of ['read', 'watch', 'listen'] as const)
      expect(feed.body.counts[type]).toBeLessThanOrEqual(10);
  });

  it('PUT validates: 400 for none or invalid, 422 for more than 10', async () => {
    const http = app.getHttpServer();
    await request(http).put('/topics').send({ names: [] }).expect(400);
    await request(http)
      .put('/topics')
      .send({ names: ['-bad'] })
      .expect(400);
    await request(http)
      .put('/topics')
      .send({ names: Array.from({ length: 11 }, (_, i) => `t${i}`) })
      .expect(422);
  });
});
