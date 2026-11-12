import { validateConfig } from './config.js';

describe('validateConfig', () => {
  it('applies defaults', () => {
    expect(validateConfig({})).toEqual({
      PORT: 4000,
      FRONTEND_ORIGIN: 'http://localhost:3000',
      DATABASE_PATH: './data/feed.db',
      FAKE_EXTERNALS: false,
      FEED_CRON: '0 6 * * *',
    });
  });

  it('parses values', () => {
    const c = validateConfig({
      PORT: '5000',
      FAKE_EXTERNALS: '1',
      YOUTUBE_API_KEY: 'k',
      VOYAGE_API_KEY: '',
    });
    expect(c.PORT).toBe(5000);
    expect(c.FAKE_EXTERNALS).toBe(true);
    expect(c.YOUTUBE_API_KEY).toBe('k');
    expect(c.VOYAGE_API_KEY).toBeUndefined();
  });

  it('rejects invalid values', () => {
    expect(() => validateConfig({ PORT: 'abc' })).toThrow();
    expect(() => validateConfig({ FAKE_EXTERNALS: 'maybe' })).toThrow();
  });
});
