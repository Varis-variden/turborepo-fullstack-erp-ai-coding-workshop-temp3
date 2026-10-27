import { describe, expect, it } from 'vitest';
import { SearchStockInputSchema, StockItemPageSchema, StockItemSchema } from './inventory.js';

describe('SearchStockInputSchema', () => {
  it('accepts an empty search (everything, first page)', () => {
    const result = SearchStockInputSchema.safeParse({});
    expect(result.success && result.data.page).toBe(1);
    expect(result.success && result.data.pageSize).toBe(20);
  });

  it('keeps a search term, trimmed', () => {
    const result = SearchStockInputSchema.safeParse({ search: '  SKU001  ' });
    expect(result.success && result.data.search).toBe('SKU001');
  });

  it('drops a blank search term to undefined so it never filters', () => {
    const result = SearchStockInputSchema.safeParse({ search: '   ' });
    expect(result.success && result.data.search).toBeUndefined();
  });

  it('uppercases the store code so a store filter is case-insensitive', () => {
    const result = SearchStockInputSchema.safeParse({ storeCode: 'b01' });
    expect(result.success && result.data.storeCode).toBe('B01');
  });

  it('coerces pagination from query strings', () => {
    const result = SearchStockInputSchema.safeParse({ page: '2', pageSize: '50' });
    expect(result.success && result.data).toMatchObject({ page: 2, pageSize: 50 });
  });
});

describe('StockItemSchema', () => {
  const item = {
    productId: 'p1',
    sku: 'SKU001',
    name: 'Drinking water pack of 6',
    unit: 'pack',
    storeCode: 'B01',
    quantity: 10,
    reorderThreshold: 3,
    lowStock: false,
  };

  it('accepts a stock item with a threshold and a low-stock flag', () => {
    expect(StockItemSchema.safeParse(item).success).toBe(true);
  });

  it('accepts a null threshold (no threshold set for the store)', () => {
    expect(StockItemSchema.safeParse({ ...item, reorderThreshold: null }).success).toBe(true);
  });

  it('rejects a fractional quantity', () => {
    expect(StockItemSchema.safeParse({ ...item, quantity: 1.5 }).success).toBe(false);
  });
});

describe('StockItemPageSchema', () => {
  it('accepts a page of stock items with its metadata', () => {
    const result = StockItemPageSchema.safeParse({
      items: [
        {
          productId: 'p3',
          sku: 'SKU003',
          name: 'Laundry detergent',
          unit: 'bag',
          storeCode: 'B01',
          quantity: 0,
          reorderThreshold: 3,
          lowStock: true,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(result.success).toBe(true);
  });
});
