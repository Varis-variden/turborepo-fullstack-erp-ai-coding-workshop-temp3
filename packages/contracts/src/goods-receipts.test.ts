import { describe, expect, it } from 'vitest';
import { ConfirmGoodsReceiptInputSchema, goodsReceiptsContract } from './goods-receipts.js';

const KEY = '3f1d6a3e-5b0e-4a53-9a58-0d0f4f7f6a11';

const validInput = {
  purchaseOrderNumber: 'PO-DEMO-001',
  idempotencyKey: KEY,
  lines: [{ sku: 'SKU001', quantity: 8 }],
};

function messages(input: unknown): string[] {
  const result = ConfirmGoodsReceiptInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('ConfirmGoodsReceiptInputSchema', () => {
  it('accepts an order number, an idempotency key and one received line', () => {
    const result = ConfirmGoodsReceiptInputSchema.safeParse(validInput);
    expect(result.success && result.data).toEqual({
      purchaseOrderNumber: 'PO-DEMO-001',
      idempotencyKey: KEY,
      lines: [{ sku: 'SKU001', quantity: 8 }],
    });
  });

  it('trims and uppercases the order number and SKUs so lookups do not depend on casing', () => {
    const result = ConfirmGoodsReceiptInputSchema.safeParse({
      ...validInput,
      purchaseOrderNumber: ' po-demo-001 ',
      lines: [{ sku: ' sku001 ', quantity: 8 }],
    });
    expect(result.success && result.data).toMatchObject({
      purchaseOrderNumber: 'PO-DEMO-001',
      lines: [{ sku: 'SKU001', quantity: 8 }],
    });
  });

  // GR-02: each received quantity is a non-negative whole number. Zero is allowed per line (a
  // line can be left undelivered), but a negative or fractional quantity never is.
  it.each([
    ['negative', -1],
    ['fractional', 1.5],
  ])('rejects a %s received quantity as not a non-negative whole number', (_label, quantity) => {
    expect(messages({ ...validInput, lines: [{ sku: 'SKU001', quantity }] })).toContain(
      'จำนวนที่รับต้องเป็นจำนวนเต็มที่ไม่ติดลบ',
    );
  });

  it('allows a zero quantity on a line as long as another line is above zero', () => {
    const result = ConfirmGoodsReceiptInputSchema.safeParse({
      ...validInput,
      lines: [
        { sku: 'SKU001', quantity: 0 },
        { sku: 'SKU002', quantity: 8 },
      ],
    });
    expect(result.success).toBe(true);
  });

  // GR-02: a receipt has to bring something in.
  it('requires at least one line, and at least one line above zero', () => {
    expect(messages({ ...validInput, lines: [] })).toContain(
      'ต้องระบุสินค้าที่รับอย่างน้อย 1 รายการ',
    );
    expect(messages({ ...validInput, lines: [{ sku: 'SKU001', quantity: 0 }] })).toContain(
      'ต้องรับสินค้าอย่างน้อย 1 รายการที่มีจำนวนมากกว่า 0',
    );
  });

  it('rejects a duplicate SKU within one receipt, whatever its casing', () => {
    expect(
      messages({
        ...validInput,
        lines: [
          { sku: 'SKU001', quantity: 1 },
          { sku: 'sku001', quantity: 2 },
        ],
      }),
    ).toContain('รหัสสินค้า (SKU) SKU001 ซ้ำในใบรับสินค้าเดียวกัน');
  });

  it('requires a purchase order number', () => {
    expect(messages({ ...validInput, purchaseOrderNumber: '  ' })).toContain(
      'กรุณาระบุเลขที่ใบสั่งซื้อ',
    );
  });

  it('requires the idempotency key to be a UUID', () => {
    expect(messages({ ...validInput, idempotencyKey: 'not-a-uuid' })).toContain(
      'รหัสป้องกันการบันทึกซ้ำไม่ถูกต้อง',
    );
  });
});

describe('goodsReceiptsContract (GR-05: confirmed receipts are final)', () => {
  // A confirmed receipt cannot be edited or cancelled because no such route exists: the contract
  // is the whole API surface, so the only operations are listing receivable orders and confirming
  // a receipt. This test is the guard against a future edit/cancel/delete route quietly making
  // receipts mutable.
  it('exposes only listOrders and confirm — no edit, cancel or delete route', () => {
    expect(Object.keys(goodsReceiptsContract).sort()).toEqual(['confirm', 'listOrders']);
  });
});
