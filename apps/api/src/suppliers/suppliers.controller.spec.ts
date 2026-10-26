import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { SuppliersController } from './suppliers.controller.js';

const supplyOne = {
  id: 's1',
  code: 'SUP01',
  name: 'SupplyOne Co Ltd',
  contactName: 'Somchai',
  contactPhone: '02-123-4567',
  contactEmail: 'sales@supplyone.co.th',
  createdAt: new Date('2026-01-02T00:00:00Z'),
};
const supplyTwo = {
  id: 's2',
  code: 'SUP02',
  name: 'SupplyTwo Co Ltd',
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

async function createController(supplier: Record<string, unknown>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SuppliersController],
    providers: [{ provide: PrismaService, useValue: { supplier } }],
  }).compile();
  return moduleRef.get(SuppliersController);
}

describe('SuppliersController', () => {
  describe('list', () => {
    it('returns a newest-first page with its total', async () => {
      const findMany = vi.fn().mockResolvedValue([supplyOne, supplyTwo]);
      const count = vi.fn().mockResolvedValue(2);
      const controller = await createController({ findMany, count });

      const result = await call(controller.list(), { page: 1, pageSize: 20 });

      expect(result.total).toBe(2);
      expect(result.items.map((s) => s.code)).toEqual(['SUP01', 'SUP02']);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }),
      );
    });

    it('asks for the right slice on a later page', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(0);
      const controller = await createController({ findMany, count });

      await call(controller.list(), { page: 3, pageSize: 10 });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });
  });

  describe('create', () => {
    it('creates a supplier from the validated input, including contact details', async () => {
      const create = vi.fn().mockResolvedValue(supplyOne);
      const controller = await createController({ create });

      const result = await call(controller.create(), {
        code: 'SUP01',
        name: 'SupplyOne Co Ltd',
        contactName: 'Somchai',
        contactPhone: '02-123-4567',
        contactEmail: 'sales@supplyone.co.th',
      });

      expect(result).toMatchObject({ code: 'SUP01', name: 'SupplyOne Co Ltd' });
      expect(create).toHaveBeenCalledWith({
        data: {
          code: 'SUP01',
          name: 'SupplyOne Co Ltd',
          contactName: 'Somchai',
          contactPhone: '02-123-4567',
          contactEmail: 'sales@supplyone.co.th',
        },
      });
    });

    it('rejects a duplicate code with an actionable Thai conflict error', async () => {
      const create = vi.fn().mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['code'] },
        }),
      );
      const controller = await createController({ create });

      await expect(
        call(controller.create(), { code: 'SUP01', name: 'SupplyOne Co Ltd' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('รหัสผู้จัดจำหน่าย'),
      });
    });

    it('is restricted to admins at the API, so a non-admin is rejected by the guard', () => {
      // The global AuthGuard reads this metadata; binding it to the route is what this asserts.
      const roles = new Reflector().get(ROLES_KEY, SuppliersController.prototype.create);

      expect(roles).toEqual(['ADMIN']);
    });
  });
});
