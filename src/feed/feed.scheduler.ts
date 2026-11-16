import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { FeedBuilder } from './feed-builder.js';
import { localDate } from './feed.service.js';

@Injectable()
export class FeedScheduler implements OnModuleInit {
  private readonly logger = new Logger(FeedScheduler.name);

  constructor(
    private readonly builder: FeedBuilder,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const expr = this.config.get<string>('FEED_CRON', '0 6 * * *');
    const job = new CronJob(expr, () => void this.run());
    this.registry.addCronJob('daily-feed', job);
    job.start();
  }

  async run(): Promise<void> {
    try {
      await this.builder.build(localDate());
    } catch (err) {
      this.logger.error(
        `Daily feed build failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
