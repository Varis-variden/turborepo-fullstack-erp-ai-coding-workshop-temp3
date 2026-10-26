import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { StoresController } from './stores.controller.js';

const central = {
  id: 's1',
  code: 'B01',
  name: 'Central Store',
  createdAt: new Date('2026-01-02T00:00:00Z'),
};
const riverside = {
  id: 's2',
  code: 'B02',
  name: 'Riverside Store',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

async function createController(store: Record<string, unknown>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [StoresController],
    providers: [{ provide: PrismaService, useValue: { store } }],
  }).compile();
  return moduleRef.get(StoresController);
}

describe('StoresController', () => {
  describe('list', () => {
    it('returns a newest-first page with its total', async () => {
      const findMany = vi.fn().mockResolvedValue([central, riverside]);
      const count = vi.fn().mockResolvedValue(2);
      const controller = await createController({ findMany, count });

      const result = await call(controller.list(), { page: 1, pageSize: 20 });

      expect(result.total).toBe(2);
      expect(result.items.map((s) => s.code)).toEqual(['B01', 'B02']);
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
    it('creates a store from the validated input', async () => {
      const create = vi.fn().mockResolvedValue(central);
      const controller = await createController({ create });

      const result = await call(controller.create(), { code: 'B01', name: 'Central Store' });

      expect(result).toMatchObject({ code: 'B01', name: 'Central Store' });
      expect(create).toHaveBeenCalledWith({ data: { code: 'B01', name: 'Central Store' } });
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
        call(controller.create(), { code: 'B01', name: 'Central Store' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('รหัสสาขา') });
    });

    it('is restricted to admins at the API, so a non-admin is rejected by the guard', () => {
      // The global AuthGuard reads this metadata; binding it to the route is what this asserts.
      const roles = new Reflector().get(ROLES_KEY, StoresController.prototype.create);

      expect(roles).toEqual(['ADMIN']);
    });
  });
});
