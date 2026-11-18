import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { asc, eq, notInArray } from 'drizzle-orm';
import { DB } from '../db/db.module.js';
import type { AppDb } from '../db/database.js';
import { topics } from '../db/schema.js';
import {
  MAX_TOPICS,
  TOPIC_SUGGESTIONS,
  type TopicDto,
} from './topics.schema.js';

@Injectable()
export class TopicsService {
  constructor(@Inject(DB) private readonly db: AppDb) {}

  list(): TopicDto[] {
    return this.db
      .select()
      .from(topics)
      .orderBy(asc(topics.createdAt), asc(topics.id))
      .all();
  }

  create(name: string): TopicDto {
    // Synchronous better-sqlite3 calls cannot interleave, so check-then-insert is safe.
    const existing = this.db.select().from(topics).all();
    if (existing.some((t) => t.name === name))
      throw new ConflictException(`Topic "${name}" already exists`);
    if (existing.length >= MAX_TOPICS)
      throw new UnprocessableEntityException(
        `At most ${MAX_TOPICS} topics are allowed`,
      );
    return this.db.insert(topics).values({ name }).returning().get();
  }

  /** Replaces the whole set in one transaction: kept names keep id and createdAt. */
  replace(names: string[]): TopicDto[] {
    const unique = [...new Set(names)];
    if (unique.length > MAX_TOPICS)
      throw new UnprocessableEntityException(
        `At most ${MAX_TOPICS} topics are allowed`,
      );
    this.db.transaction((tx) => {
      tx.delete(topics).where(notInArray(topics.name, unique)).run();
      const kept = new Set(
        tx
          .select()
          .from(topics)
          .all()
          .map((t) => t.name),
      );
      const base = Date.now();
      unique
        .filter((name) => !kept.has(name))
        .forEach((name, i) => {
          tx.insert(topics)
            .values({ name, createdAt: new Date(base + i).toISOString() })
            .run();
        });
    });
    return this.list();
  }

  remove(id: number): void {
    const deleted = this.db
      .delete(topics)
      .where(eq(topics.id, id))
      .returning({ id: topics.id })
      .all();
    if (deleted.length === 0) throw new NotFoundException('Topic not found');
  }

  suggestions(): string[] {
    const added = new Set(this.list().map((t) => t.name));
    return TOPIC_SUGGESTIONS.filter((s) => !added.has(s));
  }
}
