import { describe, expect, it } from 'vitest';
import {
  CreateProductInputSchema,
  ListProductsInputSchema,
  ProductPageSchema,
  SetProductActiveInputSchema,
} from './products.js';

const valid = {
  sku: 'SKU001',
  name: 'Drinking water pack of 6',
  category: 'Beverages',
  unit: 'pack',
  sellingPrice: '60.00',
  active: true,
  reorderThresholds: [{ storeCode: 'B01', threshold: 3 }],
};

function messages(input: unknown): string[] {
  const result = CreateProductInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('CreateProductInputSchema', () => {
  it('accepts a product with every field and a per-store reorder threshold', () => {
    expect(CreateProductInputSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults to active with no thresholds when they are omitted', () => {
    const { active: _active, reorderThresholds: _thresholds, ...minimal } = valid;

    const result = CreateProductInputSchema.parse(minimal);

    expect(result.active).toBe(true);
    expect(result.reorderThresholds).toEqual([]);
  });

  it('trims and uppercases the SKU so uniqueness does not depend on casing', () => {
    const result = CreateProductInputSchema.parse({ ...valid, sku: '  sku001 ' });

    expect(result.sku).toBe('SKU001');
  });

  it('rejects an empty SKU, name, category, or unit with a Thai message', () => {
    expect(messages({ ...valid, sku: '' })).toContain('กรุณาระบุรหัสสินค้า (SKU)');
    expect(messages({ ...valid, name: ' ' })).toContain('กรุณาระบุชื่อสินค้า');
    expect(messages({ ...valid, category: '' })).toContain('กรุณาระบุหมวดหมู่สินค้า');
    expect(messages({ ...valid, unit: '' })).toContain('กรุณาระบุหน่วยนับ');
  });

  it('accepts a zero selling price', () => {
    expect(CreateProductInputSchema.safeParse({ ...valid, sellingPrice: '0' }).success).toBe(true);
  });

  it('rejects a negative selling price with a Thai message (MD-02)', () => {
    expect(messages({ ...valid, sellingPrice: '-1.00' })).toContain('ราคาขายต้องไม่ติดลบ');
  });

  it('rejects a selling price that is not money with at most two decimals', () => {
    const expected = 'ราคาขายต้องเป็นตัวเลขและมีทศนิยมไม่เกิน 2 ตำแหน่ง';

    expect(messages({ ...valid, sellingPrice: 'abc' })).toContain(expected);
    expect(messages({ ...valid, sellingPrice: '10.505' })).toContain(expected);
    expect(messages({ ...valid, sellingPrice: '' })).toContain(expected);
  });

  it('normalises the selling price to two decimals', () => {
    expect(CreateProductInputSchema.parse({ ...valid, sellingPrice: '35' }).sellingPrice).toBe(
      '35.00',
    );
  });

  it('accepts a zero reorder threshold', () => {
    const result = CreateProductInputSchema.safeParse({
      ...valid,
      reorderThresholds: [{ storeCode: 'B01', threshold: 0 }],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a negative reorder threshold with a Thai message (MD-02)', () => {
    const result = messages({
      ...valid,
      reorderThresholds: [{ storeCode: 'B01', threshold: -1 }],
    });

    expect(result).toContain('จุดสั่งซื้อซ้ำต้องไม่ติดลบ');
  });

  it('rejects a reorder threshold that is not a whole number (MD-02)', () => {
    const result = messages({
      ...valid,
      reorderThresholds: [{ storeCode: 'B01', threshold: 2.5 }],
    });

    expect(result).toContain('จำนวนต้องเป็นจำนวนเต็ม');
  });

  it('rejects two thresholds for the same store, whatever the casing of its code', () => {
    const result = messages({
      ...valid,
      reorderThresholds: [
        { storeCode: 'B01', threshold: 3 },
        { storeCode: 'b01', threshold: 5 },
      ],
    });

    expect(result).toContain('แต่ละสาขากำหนดจุดสั่งซื้อซ้ำได้เพียงค่าเดียว');
  });
});

describe('ListProductsInputSchema', () => {
  it('lists only active products by default, which is what new documents use', () => {
    const result = ListProductsInputSchema.parse({});

    expect(result.status).toBe('ACTIVE');
    expect(result.page).toBe(1);
  });

  it('can include inactive products for historical search', () => {
    expect(ListProductsInputSchema.parse({ status: 'ALL' }).status).toBe('ALL');
  });

  it('rejects an unknown status', () => {
    expect(ListProductsInputSchema.safeParse({ status: 'DELETED' }).success).toBe(false);
  });

  it('treats a blank search as no search', () => {
    expect(ListProductsInputSchema.parse({ search: '   ' }).search).toBeUndefined();
  });
});

describe('SetProductActiveInputSchema', () => {
  it('needs an id and an explicit active flag', () => {
    expect(SetProductActiveInputSchema.safeParse({ id: 'p1', active: false }).success).toBe(true);
    expect(SetProductActiveInputSchema.safeParse({ id: 'p1' }).success).toBe(false);
  });
});

describe('ProductPageSchema', () => {
  it('parses a page of products', () => {
    const page = {
      items: [
        {
          id: 'p1',
          sku: 'SKU001',
          name: 'Drinking water pack of 6',
          category: 'Beverages',
          unit: 'pack',
          sellingPrice: '60.00',
          active: false,
          reorderThresholds: [{ storeCode: 'B01', threshold: 3 }],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    };

    expect(ProductPageSchema.safeParse(page).success).toBe(true);
  });
});
