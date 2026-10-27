import { describe, expect, it } from 'vitest';
import { isRecordNotFoundError, isUniqueConstraintError } from './prisma-errors.js';

describe('isRecordNotFoundError', () => {
  it('is true for Prisma P2025', () => {
    expect(isRecordNotFoundError({ code: 'P2025' })).toBe(true);
  });

  it('is false for any other error', () => {
    expect(isRecordNotFoundError({ code: 'P2002' })).toBe(false);
    expect(isRecordNotFoundError(new Error('boom'))).toBe(false);
    expect(isRecordNotFoundError(undefined)).toBe(false);
  });
});

describe('isUniqueConstraintError', () => {
  it('is false for a non-P2002 error', () => {
    expect(isUniqueConstraintError({ code: 'P2025' }, 'sku')).toBe(false);
    expect(isUniqueConstraintError(new Error('boom'), 'sku')).toBe(false);
  });

  it('is true for P2002 with no field required', () => {
    expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
  });

  it('matches the field in the classic meta.target shape', () => {
    expect(isUniqueConstraintError({ code: 'P2002', meta: { target: ['sku'] } }, 'sku')).toBe(true);
    expect(isUniqueConstraintError({ code: 'P2002', meta: { target: 'sku' } }, 'sku')).toBe(true);
    expect(isUniqueConstraintError({ code: 'P2002', meta: { target: ['name'] } }, 'sku')).toBe(
      false,
    );
  });

  it('matches the field by the constraint index name in the driver-adapter shape', () => {
    const error = {
      code: 'P2002',
      meta: {
        driverAdapterError: { cause: { constraint: { index: 'Product_sku_key' } } },
      },
    };
    expect(isUniqueConstraintError(error, 'sku')).toBe(true);
    expect(isUniqueConstraintError(error, 'code')).toBe(false);
  });

  it('matches the field in the driver-adapter constraint.fields when present', () => {
    const error = {
      code: 'P2002',
      meta: { driverAdapterError: { cause: { constraint: { fields: ['code'] } } } },
    };
    expect(isUniqueConstraintError(error, 'code')).toBe(true);
    expect(isUniqueConstraintError(error, 'sku')).toBe(false);
  });
});
