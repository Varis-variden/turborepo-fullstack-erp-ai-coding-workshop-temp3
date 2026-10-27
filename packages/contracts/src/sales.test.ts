import { describe, expect, it } from 'vitest';
import { CreateSaleInputSchema, ListSalesInputSchema, SaleSchema } from './sales.js';

const validInput = {
  lines: [{ sku: 'SKU001', quantity: 2 }],
};

function messages(input: unknown): string[] {
  const result = CreateSaleInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('CreateSaleInputSchema', () => {
  it('accepts one line of a SKU and a quantity', () => {
    const result = CreateSaleInputSchema.safeParse(validInput);
    expect(result.success && result.data).toEqual({ lines: [{ sku: 'SKU001', quantity: 2 }] });
  });

  it('trims and uppercases SKUs so lookups do not depend on casing', () => {
    const result = CreateSaleInputSchema.safeParse({ lines: [{ sku: ' sku001 ', quantity: 1 }] });
    expect(result.success && result.data).toMatchObject({ lines: [{ sku: 'SKU001' }] });
  });

  it('gives the caller no way to set a price: a unitPrice in the input is dropped', () => {
    const result = CreateSaleInputSchema.safeParse({
      lines: [{ sku: 'SKU001', quantity: 1, unitPrice: '1.00' }],
    });
    expect(result.success && result.data.lines[0]).toEqual({ sku: 'SKU001', quantity: 1 });
  });

  it('requires at least one product line', () => {
    expect(messages({ lines: [] })).toContain('การขายต้องมีสินค้าอย่างน้อย 1 รายการ');
  });

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 1.5],
  ])('rejects a %s quantity', (_label, quantity) => {
    expect(CreateSaleInputSchema.safeParse({ lines: [{ sku: 'SKU001', quantity }] }).success).toBe(
      false,
    );
  });

  it('says the quantity must be a positive whole number', () => {
    expect(messages({ lines: [{ sku: 'SKU001', quantity: 0 }] })).toContain(
      'จำนวนที่ขายต้องเป็นจำนวนเต็มที่มากกว่า 0',
    );
  });

  it('rejects a duplicate SKU within one sale, whatever its casing', () => {
    expect(
      messages({
        lines: [
          { sku: 'SKU001', quantity: 1 },
          { sku: 'sku001', quantity: 2 },
        ],
      }),
    ).toContain('รหัสสินค้า (SKU) SKU001 ซ้ำในการขายเดียวกัน');
  });

  it('accepts two different SKUs', () => {
    const result = CreateSaleInputSchema.safeParse({
      lines: [
        { sku: 'SKU001', quantity: 1 },
        { sku: 'SKU002', quantity: 2 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('requires a SKU on every line', () => {
    expect(messages({ lines: [{ sku: ' ', quantity: 1 }] })).toContain('กรุณาระบุรหัสสินค้า (SKU)');
  });
});

describe('SaleSchema', () => {
  const sale = {
    id: 's1',
    number: 'SAL-001',
    storeCode: 'B01',
    storeName: 'Central Store',
    createdAt: '2026-01-01T00:00:00.000Z',
    total: '155.00',
    lines: [
      {
        id: 'l1',
        sku: 'SKU001',
        name: 'Drinking water pack of 6',
        unit: 'pack',
        quantity: 2,
        unitPrice: '60.00',
        lineAmount: '120.00',
      },
      {
        id: 'l2',
        sku: 'SKU002',
        name: 'Tissue paper',
        unit: 'pack',
        quantity: 1,
        unitPrice: '35.00',
        lineAmount: '35.00',
      },
    ],
  };

  it('accepts a draft sale with its snapshotted lines, amounts and total', () => {
    expect(SaleSchema.safeParse(sale).success).toBe(true);
  });

  it('carries the line amount and the document total as two-decimal strings', () => {
    const result = SaleSchema.safeParse(sale);
    expect(result.success && result.data.total).toBe('155.00');
    expect(result.success && result.data.lines[0]?.lineAmount).toBe('120.00');
  });
});

describe('ListSalesInputSchema', () => {
  it('defaults to the first page', () => {
    const result = ListSalesInputSchema.safeParse({});
    expect(result.success && result.data).toMatchObject({ page: 1, pageSize: 20 });
  });
});
