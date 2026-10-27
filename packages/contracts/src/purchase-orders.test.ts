import { describe, expect, it } from 'vitest';
import {
  CreatePurchaseOrderInputSchema,
  ListPurchaseOrdersInputSchema,
  PurchaseOrderSchema,
} from './purchase-orders.js';

const validInput = {
  supplierCode: 'SUP01',
  storeCode: 'B01',
  expectedReceiptDate: '2026-02-01',
  lines: [{ sku: 'SKU001', quantity: 20, unitPrice: '45.00' }],
};

function messages(input: unknown): string[] {
  const result = CreatePurchaseOrderInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('CreatePurchaseOrderInputSchema', () => {
  it('accepts a supplier, store, expected receipt date and one line', () => {
    const result = CreatePurchaseOrderInputSchema.safeParse(validInput);
    expect(result.success && result.data).toEqual({
      supplierCode: 'SUP01',
      storeCode: 'B01',
      expectedReceiptDate: '2026-02-01',
      lines: [{ sku: 'SKU001', quantity: 20, unitPrice: '45.00' }],
    });
  });

  it('trims and uppercases the codes and SKUs so lookups do not depend on casing', () => {
    const result = CreatePurchaseOrderInputSchema.safeParse({
      ...validInput,
      supplierCode: ' sup01 ',
      storeCode: 'b01',
      lines: [{ sku: ' sku001 ', quantity: 1, unitPrice: '0' }],
    });
    expect(result.success && result.data).toMatchObject({
      supplierCode: 'SUP01',
      storeCode: 'B01',
      lines: [{ sku: 'SKU001' }],
    });
  });

  it('requires at least one product line', () => {
    expect(messages({ ...validInput, lines: [] })).toContain(
      'ใบสั่งซื้อต้องมีสินค้าอย่างน้อย 1 รายการ',
    );
  });

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 1.5],
  ])('rejects a %s ordered quantity', (_label, quantity) => {
    const result = CreatePurchaseOrderInputSchema.safeParse({
      ...validInput,
      lines: [{ sku: 'SKU001', quantity, unitPrice: '45.00' }],
    });
    expect(result.success).toBe(false);
  });

  it('says the quantity must be a positive whole number', () => {
    expect(
      messages({ ...validInput, lines: [{ sku: 'SKU001', quantity: 0, unitPrice: '45.00' }] }),
    ).toContain('จำนวนที่สั่งต้องเป็นจำนวนเต็มที่มากกว่า 0');
  });

  it('accepts a zero purchase unit price and normalises it to two decimals', () => {
    const result = CreatePurchaseOrderInputSchema.safeParse({
      ...validInput,
      lines: [{ sku: 'SKU001', quantity: 1, unitPrice: '0' }],
    });
    expect(result.success && result.data.lines[0]?.unitPrice).toBe('0.00');
  });

  it('rejects a negative purchase unit price', () => {
    expect(
      messages({ ...validInput, lines: [{ sku: 'SKU001', quantity: 1, unitPrice: '-0.01' }] }),
    ).toContain('ราคาซื้อต่อหน่วยต้องไม่ติดลบ');
  });

  it('rejects a purchase unit price with more than two decimals', () => {
    expect(
      messages({ ...validInput, lines: [{ sku: 'SKU001', quantity: 1, unitPrice: '45.001' }] }),
    ).toContain('ราคาซื้อต่อหน่วยต้องเป็นตัวเลขและมีทศนิยมไม่เกิน 2 ตำแหน่ง');
  });

  it('rejects a duplicate SKU within one order, whatever its casing', () => {
    expect(
      messages({
        ...validInput,
        lines: [
          { sku: 'SKU001', quantity: 1, unitPrice: '45.00' },
          { sku: 'sku001', quantity: 2, unitPrice: '46.00' },
        ],
      }),
    ).toContain('รหัสสินค้า (SKU) SKU001 ซ้ำในใบสั่งซื้อเดียวกัน');
  });

  it('accepts two different SKUs', () => {
    const result = CreatePurchaseOrderInputSchema.safeParse({
      ...validInput,
      lines: [
        { sku: 'SKU001', quantity: 1, unitPrice: '45.00' },
        { sku: 'SKU002', quantity: 2, unitPrice: '20.00' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it.each(['', '2026-13-01', '2026-02-30', '01/02/2026'])(
    'rejects %j as an expected receipt date',
    (expectedReceiptDate) => {
      expect(
        CreatePurchaseOrderInputSchema.safeParse({ ...validInput, expectedReceiptDate }).success,
      ).toBe(false);
    },
  );

  it('requires a supplier and a destination store', () => {
    expect(messages({ ...validInput, supplierCode: ' ' })).toContain('กรุณาระบุผู้จัดจำหน่าย');
    expect(messages({ ...validInput, storeCode: '' })).toContain('กรุณาระบุสาขาปลายทาง');
  });
});

describe('PurchaseOrderSchema', () => {
  const order = {
    id: 'po1',
    number: 'PO-001',
    status: 'DRAFT',
    supplierCode: 'SUP01',
    supplierName: 'SupplyOne Co Ltd',
    storeCode: 'B01',
    storeName: 'Central Store',
    expectedReceiptDate: '2026-02-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    lines: [
      {
        id: 'l1',
        sku: 'SKU001',
        name: 'Drinking water pack of 6',
        unit: 'pack',
        quantity: 20,
        unitPrice: '45.00',
      },
    ],
  };

  it('accepts a draft order with its snapshotted lines', () => {
    expect(PurchaseOrderSchema.safeParse(order).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(PurchaseOrderSchema.safeParse({ ...order, status: 'SHIPPED' }).success).toBe(false);
  });
});

describe('ListPurchaseOrdersInputSchema', () => {
  it('defaults to the first page', () => {
    const result = ListPurchaseOrdersInputSchema.safeParse({});
    expect(result.success && result.data).toMatchObject({ page: 1, pageSize: 20 });
  });
});
