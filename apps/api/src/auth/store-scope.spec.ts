import type { User } from '@erp/contracts';
import { ORPCError } from '@orpc/nest';
import { describe, expect, it } from 'vitest';
import { assertStoreScope } from './store-scope.js';

const staffB01: User = {
  id: 'u1',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STAFF',
  storeId: 'B01',
};

const manager: User = {
  id: 'u2',
  email: 'manager01@erp.local',
  name: 'Manager',
  role: 'MANAGER',
  storeId: null,
};

describe('assertStoreScope', () => {
  it('allows a store-bound user to act for their own store', () => {
    expect(() => assertStoreScope(staffB01, 'B01')).not.toThrow();
  });

  it('rejects a store-bound user acting for another store with FORBIDDEN', () => {
    expect(() => assertStoreScope(staffB01, 'B02')).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('throws an ORPCError (not a plain Error)', () => {
    let thrown: unknown;
    try {
      assertStoreScope(staffB01, 'B02');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ORPCError);
  });

  it('allows an unassigned user (null store) to act for any store', () => {
    expect(() => assertStoreScope(manager, 'B01')).not.toThrow();
    expect(() => assertStoreScope(manager, 'B02')).not.toThrow();
  });
});
