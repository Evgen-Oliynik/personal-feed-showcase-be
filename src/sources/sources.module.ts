import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import { DevtoSource } from './devto.source.js';
import { createFixtureSources } from './fixtures/index.js';
import { ItunesSource } from './itunes.source.js';
import type { MediaSource } from './media-source.js';
import { MediumSource } from './medium.source.js';
import { YoutubeSource } from './youtube.source.js';

export const SOURCES = Symbol('SOURCES');

@Module({
  providers: [
    DevtoSource,
    MediumSource,
    YoutubeSource,
    ItunesSource,
    {
      provide: SOURCES,
      inject: [
        ConfigService,
        DevtoSource,
        MediumSource,
        YoutubeSource,
        ItunesSource,
      ],
      useFactory: (
        config: ConfigService<AppConfig, true>,
        ...real: MediaSource[]
      ): MediaSource[] =>
        config.get('FAKE_EXTERNALS', { infer: true })
          ? createFixtureSources()
          : real.filter((s) => s.enabled()),
    },
  ],
  exports: [SOURCES],
})
export class SourcesModule {}
