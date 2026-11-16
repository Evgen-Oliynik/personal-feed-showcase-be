import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module.js';
import { FeedBuilder } from './feed-builder.js';

@Module({
  imports: [SourcesModule],
  providers: [FeedBuilder],
  exports: [FeedBuilder],
})
export class FeedModule {}
