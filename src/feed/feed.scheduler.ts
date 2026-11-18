import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

@Injectable()
export class FeedScheduler implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const expr = this.config.get<string>('FEED_CRON', '0 6 * * *');
    // Prewarming requested topics arrives with US-user-feed-005; until then the job fires without work.
    const job = new CronJob(expr, () => undefined);
    this.registry.addCronJob('daily-feed', job);
    job.start();
  }
}
