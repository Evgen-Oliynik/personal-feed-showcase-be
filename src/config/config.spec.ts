import { validateConfig } from './config.js';

describe('validateConfig', () => {
  it('applies defaults', () => {
    expect(validateConfig({})).toEqual({
      PORT: 4000,
      FRONTEND_ORIGIN: 'http://localhost:3000',
      DATABASE_PATH: './data/feed.db',
      FAKE_EXTERNALS: false,
      FEED_CRON: '0 6 * * *',
      CHAT_MAX_DISTANCE: 0.6,
      EMBEDDING_MODEL: 'Xenova/all-MiniLM-L6-v2',
    });
  });

  it('parses values', () => {
    const c = validateConfig({
      PORT: '5000',
      FAKE_EXTERNALS: '1',
      YOUTUBE_API_KEY: 'k',
    });
    expect(c.PORT).toBe(5000);
    expect(c.FAKE_EXTERNALS).toBe(true);
    expect(c.YOUTUBE_API_KEY).toBe('k');
    expect(c.EMBEDDING_MODEL).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('accepts a valid FEED_CRON', () => {
    expect(validateConfig({ FEED_CRON: '*/5 * * * *' }).FEED_CRON).toBe(
      '*/5 * * * *',
    );
  });

  it('rejects a malformed FEED_CRON', () => {
    expect(() => validateConfig({ FEED_CRON: 'abc' })).toThrow(
      /FEED_CRON is not a valid cron expression/,
    );
  });

  it('rejects invalid values', () => {
    expect(() => validateConfig({ PORT: 'abc' })).toThrow();
    expect(() => validateConfig({ FAKE_EXTERNALS: 'maybe' })).toThrow();
  });
});
