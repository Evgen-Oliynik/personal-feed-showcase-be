import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { gte } from 'drizzle-orm';
import type { AppDb } from '../db/database.js';
import { DB } from '../db/db.module.js';
import { topicRequests } from '../db/schema.js';
import { localDate } from './feed.service.js';
import { TopicPool } from './topic-pool.js';

/** Topics requested within this many days are prewarmed by the cron. */
const PREWARM_DAYS = 7;

@Injectable()
export class FeedScheduler implements OnModuleInit {
  private readonly logger = new Logger(FeedScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    @Inject(DB) private readonly db: AppDb,
    private readonly pool: TopicPool,
  ) {}

  onModuleInit(): void {
    const expr = this.config.get<string>('FEED_CRON', '0 6 * * *');
    const job = new CronJob(expr, () => void this.prewarm());
    this.registry.addCronJob('daily-feed', job);
    job.start();
  }

  /** Ensures today's pool for each recently requested topic, one after another; never throws. */
  async prewarm(now = new Date()): Promise<void> {
    try {
      const since = new Date(now);
      since.setDate(since.getDate() - PREWARM_DAYS);
      const today = localDate(now);
      const topics = this.db
        .select({ topic: topicRequests.topic })
        .from(topicRequests)
        .where(gte(topicRequests.lastRequestedDate, localDate(since)))
        .all();
      for (const { topic } of topics) {
        try {
          await this.pool.ensure(topic, today);
        } catch (err) {
          this.logger.warn(`Prewarm of "${topic}" failed: ${String(err)}`);
        }
      }
    } catch (err) {
      this.logger.error(`Prewarm failed: ${String(err)}`);
    }
  }
}
