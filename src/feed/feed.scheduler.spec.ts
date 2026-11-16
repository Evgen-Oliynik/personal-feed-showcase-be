import type { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { FeedScheduler } from './feed.scheduler.js';

describe('FeedScheduler', () => {
  it('logs a failed run instead of throwing', async () => {
    const builder = { build: vi.fn().mockRejectedValue(new Error('boom')) };
    const s = new FeedScheduler(builder as never, {} as never, {} as never);
    const error = vi.fn();
    (s as unknown as { logger: Pick<Logger, 'error'> }).logger = { error };
    await expect(s.run()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('registers the daily-feed cron job on init', () => {
    const registry = new SchedulerRegistry();
    const config = { get: vi.fn().mockReturnValue('0 7 * * *') };
    const s = new FeedScheduler({} as never, config as never, registry);
    s.onModuleInit();
    const job = registry.getCronJob('daily-feed');
    expect(job.cronTime.source).toBe('0 7 * * *');
    void job.stop();
  });
});
