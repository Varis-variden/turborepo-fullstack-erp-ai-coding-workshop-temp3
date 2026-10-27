import { defineConfig } from 'vitest/config';

// Integration specs talk to a real Postgres (DATABASE_URL, default: the compose Postgres on
// localhost) that has the migrations applied. Each spec creates and removes its own rows, so they
// can share the dev database, and they run one file at a time.
export default defineConfig({
  test: {
    include: ['src/**/*.integration.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
