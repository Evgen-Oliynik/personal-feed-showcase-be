import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DbHandle } from '../db/database.js';
import { topicRequests } from '../db/schema.js';
import { FeedScheduler } from './feed.scheduler.js';
import type { TopicPool } from './topic-pool.js';

describe('FeedScheduler', () => {
  let h: DbHandle;
  const now = new Date(2026, 10, 18, 6, 0, 0);
  beforeEach(() => {
    h = openDatabase(':memory:');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    h.sqlite.close();
  });

  const make = (ensure: TopicPool['ensure']) =>
    new FeedScheduler(
      { get: vi.fn().mockReturnValue('0 7 * * *') } as never,
      new SchedulerRegistry(),
      h.db,
      { ensure } as TopicPool,
    );

  const seed = (rows: Record<string, string>) =>
    h.db
      .insert(topicRequests)
      .values(
        Object.entries(rows).map(([topic, lastRequestedDate]) => ({
          topic,
          lastRequestedDate,
        })),
      )
      .run();

  it('registers the daily-feed cron job on init', () => {
    const registry = new SchedulerRegistry();
    const s = new FeedScheduler(
      { get: vi.fn().mockReturnValue('0 7 * * *') } as never,
      registry,
      h.db,
      {} as TopicPool,
    );
    s.onModuleInit();
    const job = registry.getCronJob('daily-feed');
    expect(job.cronTime.source).toBe('0 7 * * *');
    void job.stop();
  });

  it('prewarms only topics requested within the last 7 days, for today', async () => {
    seed({
      today: '2026-11-18',
      edge: '2026-11-11',
      stale: '2026-11-10',
    });
    const ensure = vi.fn(async () => {});
    await make(ensure).prewarm(now);
    expect(ensure.mock.calls.map((c) => c.join('|')).sort()).toEqual([
      'edge|2026-11-18',
      'today|2026-11-18',
    ]);
  });

  it('logs a failing topic and carries on with the rest', async () => {
    seed({ a: '2026-11-18', b: '2026-11-18', c: '2026-11-18' });
    const ensure = vi.fn(async (topic: string) => {
      if (topic === 'b') throw new Error('boom');
    });
    await expect(make(ensure).prewarm(now)).resolves.toBeUndefined();
    expect(ensure).toHaveBeenCalledTimes(3);
  });
});
