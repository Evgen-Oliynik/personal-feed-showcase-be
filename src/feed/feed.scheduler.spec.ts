import type { Logger } from '@nestjs/common';
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
});
