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

  it('returns an empty feed with no topics', async () => {
    const res = await request(app.getHttpServer())
      .get('/feed/today')
      .expect(200);
    expect(res.body).toMatchObject({
      items: [],
      counts: { read: 0, watch: 0, listen: 0 },
      reason: 'no-topics',
    });
    expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('builds 10 of each type and serves the same items again', async () => {
    const http = app.getHttpServer();
    await request(http).post('/topics').send({ name: 'react' }).expect(201);
    await request(http).post('/topics').send({ name: 'rust' }).expect(201);

    const [a, b] = await Promise.all([
      request(http).get('/feed/today').expect(200),
      request(http).get('/feed/today').expect(200),
    ]);
    expect(a.body.limits).toEqual({ read: 10, watch: 10, listen: 10 });
    expect(a.body.counts).toEqual({ read: 10, watch: 10, listen: 10 });
    expect(a.body.items).toHaveLength(30);
    expect(a.body.reason).toBeUndefined();
    expect(b.body).toEqual(a.body);

    const again = await request(http).get('/feed/today').expect(200);
    expect(again.body.items).toEqual(a.body.items);
    expect(again.body.builtAt).toBe(a.body.builtAt);
  });
});
