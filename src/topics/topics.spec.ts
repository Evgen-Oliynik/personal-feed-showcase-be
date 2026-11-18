import { createTopicSchema, TOPIC_SUGGESTIONS } from './topics.schema.js';

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

describe('TOPIC_SUGGESTIONS', () => {
  it('has at least 12 valid names', () => {
    expect(TOPIC_SUGGESTIONS.length).toBeGreaterThanOrEqual(12);
    for (const s of TOPIC_SUGGESTIONS) expect(parse(s).success).toBe(true);
  });
});
