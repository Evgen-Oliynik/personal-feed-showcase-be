import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    env: { DATABASE_PATH: ':memory:', FAKE_EXTERNALS: '1' },
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
