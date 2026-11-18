import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { openDatabase } from '../db/database.js';
import { createTopicSchema, TOPIC_SUGGESTIONS } from './topics.schema.js';
import { TopicsService } from './topics.service.js';

const parse = (name: string) => createTopicSchema.safeParse({ name });

describe('createTopicSchema', () => {
  it('trims and lowercases', () => {
    expect(parse('  React Native ').data).toEqual({ name: 'react native' });
  });

  it.each(['', '   ', '-rust', 'a'.repeat(41), 'emoji🙂', 'a_b'])(
    'rejects %j',
    (name) => {
      expect(parse(name).success).toBe(false);
    },
  );

  it.each(['c++', 'c#', '.net'.slice(1), 'a'.repeat(40), 'web-3.0'])(
    'accepts %j',
    (name) => {
      expect(parse(name).success).toBe(true);
    },
  );

  it('rejects a missing name', () => {
    expect(createTopicSchema.safeParse({}).success).toBe(false);
  });
});

describe('TopicsService', () => {
  let service: TopicsService;

  beforeEach(() => {
    service = new TopicsService(openDatabase(':memory:').db);
  });

  it('creates and lists', () => {
    const t = service.create('react');
    expect(t).toMatchObject({ name: 'react' });
    expect(service.list()).toEqual([t]);
  });

  it('409 on duplicate', () => {
    service.create('react');
    expect(() => service.create('react')).toThrow(ConflictException);
  });

  it('422 at the 10-topic limit', () => {
    for (let i = 0; i < 10; i++) service.create(`t${i}`);
    expect(() => service.create('extra')).toThrow(UnprocessableEntityException);
  });

  it('404 on unknown id, deletes known', () => {
    expect(() => service.remove(999)).toThrow(NotFoundException);
    const t = service.create('react');
    service.remove(t.id);
    expect(service.list()).toEqual([]);
  });

  it('suggestions are >=12 and exclude added topics', () => {
    expect(TOPIC_SUGGESTIONS.length).toBeGreaterThanOrEqual(12);
    service.create('react');
    expect(service.suggestions()).not.toContain('react');
    expect(service.suggestions()).toContain('typescript');
  });

  it('replace keeps kept topics, drops removed, inserts new in order', () => {
    const a = service.create('a');
    service.create('b');
    const out = service.replace(['c', 'a', 'd', 'c']);
    expect(out.map((t) => t.name)).toEqual(['a', 'c', 'd']);
    expect(out[0]).toEqual(a);
  });

  it('replace 422 over 10 distinct names', () => {
    expect(() =>
      service.replace(Array.from({ length: 11 }, (_, i) => `t${i}`)),
    ).toThrow(UnprocessableEntityException);
  });
});
