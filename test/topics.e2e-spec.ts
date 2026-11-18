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

  it('serves the fixed suggestion list', async () => {
    const res = await request(app.getHttpServer())
      .get('/topics/suggestions')
      .expect(200);
    expect(res.body).toContain('react');
    expect(res.body.length).toBeGreaterThanOrEqual(12);
  });

  it('no longer serves the topic set', async () => {
    const http = app.getHttpServer();
    await request(http).get('/topics').expect(404);
    await request(http).post('/topics').send({ name: 'react' }).expect(404);
    await request(http)
      .put('/topics')
      .send({ names: ['react'] })
      .expect(404);
    await request(http).delete('/topics/1').expect(404);
  });
});
