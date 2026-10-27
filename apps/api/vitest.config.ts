import { configDefaults, defineConfig } from 'vitest/config';

// The default suite is the fast one: stubbed Prisma, no database. The real-Postgres integration
// specs (`*.integration.spec.ts`) run through `vitest.integration.config.ts` instead.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.integration.spec.ts'],
  },
});
