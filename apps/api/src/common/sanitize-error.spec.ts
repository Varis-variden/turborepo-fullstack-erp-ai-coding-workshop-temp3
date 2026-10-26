import { ORPCError } from '@orpc/nest';
import { describe, expect, it } from 'vitest';
import { sanitizeError } from './sanitize-error.js';

describe('sanitizeError', () => {
  it('passes an ORPCError through unchanged so its Thai message reaches the client', () => {
    const original = new ORPCError('CONFLICT', { message: 'รหัสสาขา B01 ถูกใช้งานแล้ว' });

    expect(sanitizeError(original)).toBe(original);
  });

  it('replaces an unexpected error with a generic Thai internal error', () => {
    const sanitized = sanitizeError(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    expect(sanitized).toBeInstanceOf(ORPCError);
    expect(sanitized.code).toBe('INTERNAL_SERVER_ERROR');
    expect(sanitized.message).toMatch(/[\u0E00-\u0E7F]/); // contains Thai characters
  });

  it('never leaks the original message, stack, or database detail', () => {
    const dbError = Object.assign(new Error('Invalid `prisma.store.create()` invocation'), {
      code: 'P2002',
      stack: 'Error: at PrismaClient._request (/app/node_modules/@prisma/client)',
    });

    const sanitized = sanitizeError(dbError);

    expect(sanitized.message).not.toContain('prisma');
    expect(sanitized.message).not.toContain('P2002');
    expect(JSON.stringify(sanitized)).not.toContain('node_modules');
  });
});
