import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { openDatabase, type DbHandle } from './database.js';
import type { AppConfig } from '../config/config.js';

export const DB_HANDLE = Symbol('DB_HANDLE');
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        openDatabase(config.get('DATABASE_PATH', { infer: true })),
    },
    {
      provide: DB,
      inject: [DB_HANDLE],
      useFactory: (h: DbHandle) => h.db,
    },
  ],
  exports: [DB, DB_HANDLE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  onApplicationShutdown() {
    this.handle.sqlite.close();
  }
}
