import { describe, expect, it } from 'vitest';
import { CreateStoreInputSchema, paginated, PaginationInputSchema, StoreSchema } from './stores.js';

describe('CreateStoreInputSchema', () => {
  it('accepts a store with a code and a name', () => {
    expect(CreateStoreInputSchema.safeParse({ code: 'B01', name: 'Central Store' }).success).toBe(
      true,
    );
  });

  it('rejects an empty code', () => {
    expect(CreateStoreInputSchema.safeParse({ code: '', name: 'Central Store' }).success).toBe(
      false,
    );
  });

  it('rejects an empty name', () => {
    expect(CreateStoreInputSchema.safeParse({ code: 'B01', name: '' }).success).toBe(false);
  });

  it('trims surrounding whitespace from the code and name', () => {
    const result = CreateStoreInputSchema.safeParse({ code: '  B01  ', name: '  Central  ' });
    expect(result.success && result.data).toEqual({ code: 'B01', name: 'Central' });
  });

  it('uppercases the code so codes are unique regardless of case', () => {
    const result = CreateStoreInputSchema.safeParse({ code: 'b01', name: 'Central' });
    expect(result.success && result.data.code).toBe('B01');
  });
});

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
  const Page = paginated(StoreSchema);

  it('accepts a page of stores with its metadata', () => {
    const result = Page.safeParse({
      items: [{ id: 's1', code: 'B01', name: 'Central Store', createdAt: '2026-01-01T00:00:00Z' }],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(result.success).toBe(true);
  });
});
