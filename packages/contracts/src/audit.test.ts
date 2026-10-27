import { describe, expect, it } from 'vitest';
import {
  AdjustStockInputSchema,
  AuditEntryPageSchema,
  AuditEntrySchema,
  ListAuditInputSchema,
} from './audit.js';

describe('AdjustStockInputSchema', () => {
  const base = { sku: 'SKU001', storeCode: 'B01', quantityChange: 5, reason: 'Stock count correction' };

  it('accepts a positive adjustment with a reason', () => {
    const result = AdjustStockInputSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('accepts a negative adjustment (a reduction)', () => {
    const result = AdjustStockInputSchema.safeParse({ ...base, quantityChange: -3 });
    expect(result.success).toBe(true);
  });

  it('uppercases the sku and store code so lookups do not depend on casing', () => {
    const result = AdjustStockInputSchema.safeParse({ ...base, sku: 'sku001', storeCode: 'b01' });
    expect(result.success && result.data.sku).toBe('SKU001');
    expect(result.success && result.data.storeCode).toBe('B01');
  });

  it('trims the reason', () => {
    const result = AdjustStockInputSchema.safeParse({ ...base, reason: '  recount  ' });
    expect(result.success && result.data.reason).toBe('recount');
  });

  it('rejects a missing reason (reason is mandatory, INV-05)', () => {
    const result = AdjustStockInputSchema.safeParse({ sku: 'SKU001', storeCode: 'B01', quantityChange: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects a blank reason (INV-05)', () => {
    const result = AdjustStockInputSchema.safeParse({ ...base, reason: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects a zero change (an adjustment must move stock)', () => {
    const result = AdjustStockInputSchema.safeParse({ ...base, quantityChange: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects a fractional change (whole units only, MD-02)', () => {
    const result = AdjustStockInputSchema.safeParse({ ...base, quantityChange: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe('AuditEntrySchema', () => {
  const entry = {
    id: 'a1',
    action: 'STOCK_ADJUSTMENT',
    actorId: 'u-mgr',
    actorName: 'Manager 01',
    storeCode: 'B01',
    sourceType: 'ADJUSTMENT',
    sourceId: 'm1',
    outcome: 'POSTED',
    detail: 'Stock count correction',
    createdAt: '2026-10-27T00:00:00.000Z',
  };

  it('accepts a posted audit entry', () => {
    expect(AuditEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('accepts a rejected outcome', () => {
    expect(AuditEntrySchema.safeParse({ ...entry, outcome: 'REJECTED' }).success).toBe(true);
  });

  it('accepts a null source id and detail', () => {
    expect(AuditEntrySchema.safeParse({ ...entry, sourceId: null, detail: null }).success).toBe(true);
  });

  it('rejects an unknown outcome', () => {
    expect(AuditEntrySchema.safeParse({ ...entry, outcome: 'MAYBE' }).success).toBe(false);
  });
});

describe('ListAuditInputSchema', () => {
  it('defaults pagination for an empty input', () => {
    const result = ListAuditInputSchema.safeParse({});
    expect(result.success && result.data.page).toBe(1);
    expect(result.success && result.data.pageSize).toBe(20);
  });

  it('uppercases the store code filter', () => {
    const result = ListAuditInputSchema.safeParse({ storeCode: 'b01' });
    expect(result.success && result.data.storeCode).toBe('B01');
  });
});

describe('AuditEntryPageSchema', () => {
  it('accepts a page of audit entries with its metadata', () => {
    const result = AuditEntryPageSchema.safeParse({
      items: [
        {
          id: 'a1',
          action: 'STOCK_ADJUSTMENT',
          actorId: 'u-mgr',
          actorName: 'Manager 01',
          storeCode: 'B01',
          sourceType: 'ADJUSTMENT',
          sourceId: 'm1',
          outcome: 'POSTED',
          detail: 'recount',
          createdAt: '2026-10-27T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(result.success).toBe(true);
  });
});
