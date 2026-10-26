import { describe, expect, it } from 'vitest';
import { CreateSupplierInputSchema, SupplierPageSchema } from './suppliers.js';

describe('CreateSupplierInputSchema', () => {
  it('accepts a supplier with a code, a name, and contact details', () => {
    const result = CreateSupplierInputSchema.safeParse({
      code: 'SUP01',
      name: 'SupplyOne Co Ltd',
      contactName: 'Somchai',
      contactPhone: '02-123-4567',
      contactEmail: 'somchai@supplyone.co.th',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a supplier with only a code and a name (contact details optional)', () => {
    expect(CreateSupplierInputSchema.safeParse({ code: 'SUP01', name: 'SupplyOne' }).success).toBe(
      true,
    );
  });

  it('rejects an empty code', () => {
    expect(CreateSupplierInputSchema.safeParse({ code: '', name: 'SupplyOne' }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(CreateSupplierInputSchema.safeParse({ code: 'SUP01', name: '' }).success).toBe(false);
  });

  it('rejects a malformed contact email', () => {
    expect(
      CreateSupplierInputSchema.safeParse({
        code: 'SUP01',
        name: 'SupplyOne',
        contactEmail: 'not-an-email',
      }).success,
    ).toBe(false);
  });

  it('trims surrounding whitespace from the code and name', () => {
    const result = CreateSupplierInputSchema.safeParse({ code: '  SUP01  ', name: '  SupplyOne  ' });
    expect(result.success && result.data).toMatchObject({ code: 'SUP01', name: 'SupplyOne' });
  });

  it('uppercases the code so codes are unique regardless of case', () => {
    const result = CreateSupplierInputSchema.safeParse({ code: 'sup01', name: 'SupplyOne' });
    expect(result.success && result.data.code).toBe('SUP01');
  });
});

describe('SupplierPageSchema', () => {
  it('accepts a newest-first page of suppliers with its metadata', () => {
    const result = SupplierPageSchema.safeParse({
      items: [
        {
          id: 's1',
          code: 'SUP01',
          name: 'SupplyOne Co Ltd',
          contactName: 'Somchai',
          contactPhone: '02-123-4567',
          contactEmail: 'somchai@supplyone.co.th',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a supplier whose optional contact details are null', () => {
    const result = SupplierPageSchema.safeParse({
      items: [
        {
          id: 's1',
          code: 'SUP01',
          name: 'SupplyOne Co Ltd',
          contactName: null,
          contactPhone: null,
          contactEmail: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(result.success).toBe(true);
  });
});
