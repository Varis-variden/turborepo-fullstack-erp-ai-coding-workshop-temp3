import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { paginated, PaginationInputSchema } from './pagination.js';

describe('PaginationInputSchema', () => {
  it('defaults to the first page with a sane page size', () => {
    const result = PaginationInputSchema.safeParse({});
    expect(result.success && result.data).toEqual({ page: 1, pageSize: 20 });
  });

  it('rejects a page below 1', () => {
    expect(PaginationInputSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('rejects a page size above the cap', () => {
    expect(PaginationInputSchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  });
});

describe('paginated', () => {
  const Page = paginated(z.object({ id: z.string() }));

  it('accepts a page of items with its metadata', () => {
    const result = Page.safeParse({
      items: [{ id: 'a' }],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a page missing its total', () => {
    const result = Page.safeParse({ items: [], page: 1, pageSize: 20 });
    expect(result.success).toBe(false);
  });
});
