import { SchedulerRegistry } from '@nestjs/schedule';
import { FeedScheduler } from './feed.scheduler.js';

describe('FeedScheduler', () => {
  it('registers the daily-feed cron job on init', () => {
    const registry = new SchedulerRegistry();
    const config = { get: vi.fn().mockReturnValue('0 7 * * *') };
    const s = new FeedScheduler(config as never, registry);
    s.onModuleInit();
    const job = registry.getCronJob('daily-feed');
    expect(job.cronTime.source).toBe('0 7 * * *');
    void job.stop();
  });
});
