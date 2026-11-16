import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.js';
import { DevtoSource } from './devto.source.js';
import { createFixtureSources } from './fixtures/index.js';
import { ItunesSource } from './itunes.source.js';
import type { MediaSource } from './media-source.js';
import { MediumSource } from './medium.source.js';
import { YoutubeSource } from './youtube.source.js';

export const SOURCES = Symbol('SOURCES');

/** The env key each keyed source needs to be enabled. */
const REQUIRED_KEY: Partial<Record<MediaSource['id'], string>> = {
  youtube: 'YOUTUBE_API_KEY',
};

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
      ): MediaSource[] => {
        if (config.get('FAKE_EXTERNALS', { infer: true })) {
          return createFixtureSources();
        }
        const logger = new Logger(SourcesModule.name);
        for (const s of real) {
          if (!s.enabled()) {
            logger.warn(`${s.id} disabled: ${REQUIRED_KEY[s.id]} is not set`);
          }
        }
        return real.filter((s) => s.enabled());
      },
    },
  ],
  exports: [SOURCES],
})
export class SourcesModule {}
