import { describe, expect, it } from 'vitest';
import { RoleSchema, UserSchema } from './auth.js';

describe('RoleSchema', () => {
  it.each(['ADMIN', 'PURCHASING', 'STAFF', 'MANAGER'])('accepts the %s role', (role) => {
    expect(RoleSchema.safeParse(role).success).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(RoleSchema.safeParse('OWNER').success).toBe(false);
  });

  it('has exactly the four TOR roles', () => {
    expect(new Set(RoleSchema.options)).toEqual(
      new Set(['ADMIN', 'PURCHASING', 'STAFF', 'MANAGER']),
    );
  });
});

describe('UserSchema', () => {
  const base = { id: 'u1', email: 'user@erp.local', name: 'User', role: 'STAFF' as const };

  it('accepts a user assigned to a store', () => {
    expect(UserSchema.safeParse({ ...base, storeId: 'B01' }).success).toBe(true);
  });

  it('accepts a user with no store (all stores)', () => {
    expect(UserSchema.safeParse({ ...base, storeId: null, role: 'MANAGER' }).success).toBe(true);
  });
});
