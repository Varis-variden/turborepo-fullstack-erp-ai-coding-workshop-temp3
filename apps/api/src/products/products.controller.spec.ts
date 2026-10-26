import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProductsController } from './products.controller.js';

// Prisma hands back a Decimal; the handler only relies on `toFixed`, so a stand-in is enough.
const decimal = (value: string) => ({ toFixed: (digits: number) => Number(value).toFixed(digits) });

const water = {
  id: 'p1',
  sku: 'SKU001',
  name: 'Drinking water pack of 6',
  category: 'Beverages',
  unit: 'pack',
  sellingPrice: decimal('60'),
  active: true,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  reorderThresholds: [{ threshold: 3, store: { code: 'B01' } }],
};
const tissue = {
  ...water,
  id: 'p2',
  sku: 'SKU002',
  name: 'Tissue paper',
  sellingPrice: decimal('35.5'),
  active: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  reorderThresholds: [],
};

async function createController(stubs: { product: object; store?: object }) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProductsController],
    providers: [{ provide: PrismaService, useValue: { store: {}, ...stubs } }],
  }).compile();
  return moduleRef.get(ProductsController);
}

const createInput = {
  sku: 'SKU001',
  name: 'Drinking water pack of 6',
  category: 'Beverages',
  unit: 'pack',
  sellingPrice: '60',
  reorderThresholds: [{ storeCode: 'B01', threshold: 3 }],
};

function uniqueViolation(target: string) {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: [target] },
  });
}

describe('ProductsController', () => {
  describe('list', () => {
    it('returns a newest-first page with prices as two-decimal strings and thresholds by store code', async () => {
      const findMany = vi.fn().mockResolvedValue([water, tissue]);
      const count = vi.fn().mockResolvedValue(2);
      const controller = await createController({ product: { findMany, count } });

      const result = await call(controller.list(), { page: 1, pageSize: 20, status: 'ALL' });

      expect(result.total).toBe(2);
      expect(result.items.map((p) => [p.sku, p.sellingPrice, p.active])).toEqual([
        ['SKU001', '60.00', true],
        ['SKU002', '35.50', false],
      ]);
      expect(result.items[0]?.reorderThresholds).toEqual([{ storeCode: 'B01', threshold: 3 }]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }),
      );
    });

    it('offers only active products by default, so a new document never sees a deactivated one', async () => {
      const findMany = vi.fn().mockResolvedValue([water]);
      const count = vi.fn().mockResolvedValue(1);
      const controller = await createController({ product: { findMany, count } });

      await call(controller.list(), { page: 1, pageSize: 20, status: 'ACTIVE' });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
      );
      expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ active: true }) });
    });

    it('includes deactivated products in historical search', async () => {
      const findMany = vi.fn().mockResolvedValue([tissue]);
      const count = vi.fn().mockResolvedValue(1);
      const controller = await createController({ product: { findMany, count } });

      const result = await call(controller.list(), { page: 1, pageSize: 20, status: 'ALL' });

      expect(findMany.mock.calls[0]?.[0].where).not.toHaveProperty('active');
      expect(result.items[0]).toMatchObject({ sku: 'SKU002', active: false });
    });

    it('searches SKU and name, ignoring case', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(0);
      const controller = await createController({ product: { findMany, count } });

      await call(controller.list(), { page: 1, pageSize: 20, status: 'ALL', search: 'sku00' });

      expect(findMany.mock.calls[0]?.[0].where).toEqual({
        OR: [
          { sku: { contains: 'sku00', mode: 'insensitive' } },
          { name: { contains: 'sku00', mode: 'insensitive' } },
        ],
      });
    });

    it('asks for the right slice on a later page', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(0);
      const controller = await createController({ product: { findMany, count } });

      await call(controller.list(), { page: 3, pageSize: 10, status: 'ACTIVE' });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });
  });

  describe('create', () => {
    it('creates a product with its per-store reorder threshold', async () => {
      const create = vi.fn().mockResolvedValue(water);
      const findMany = vi.fn().mockResolvedValue([{ id: 'st1', code: 'B01' }]);
      const controller = await createController({ product: { create }, store: { findMany } });

      const result = await call(controller.create(), createInput);

      expect(result).toMatchObject({ sku: 'SKU001', sellingPrice: '60.00', active: true });
      expect(findMany).toHaveBeenCalledWith({
        where: { code: { in: ['B01'] } },
        select: { id: true, code: true },
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            sku: 'SKU001',
            name: 'Drinking water pack of 6',
            category: 'Beverages',
            unit: 'pack',
            sellingPrice: '60.00',
            active: true,
            reorderThresholds: { create: [{ storeId: 'st1', threshold: 3 }] },
          },
        }),
      );
    });

    it('creates a product without any thresholds without looking up stores', async () => {
      const create = vi.fn().mockResolvedValue({ ...water, reorderThresholds: [] });
      const findMany = vi.fn();
      const controller = await createController({ product: { create }, store: { findMany } });

      await call(controller.create(), { ...createInput, reorderThresholds: [] });

      expect(findMany).not.toHaveBeenCalled();
      expect(create.mock.calls[0]?.[0].data.reorderThresholds).toEqual({ create: [] });
    });

    it('rejects a duplicate SKU with an actionable Thai conflict error (MD-01)', async () => {
      const create = vi.fn().mockRejectedValue(uniqueViolation('sku'));
      const findMany = vi.fn().mockResolvedValue([{ id: 'st1', code: 'B01' }]);
      const controller = await createController({ product: { create }, store: { findMany } });

      await expect(call(controller.create(), createInput)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('รหัสสินค้า (SKU) SKU001'),
      });
    });

    it('rejects a threshold for a store that does not exist, and creates nothing', async () => {
      const create = vi.fn();
      const findMany = vi.fn().mockResolvedValue([]);
      const controller = await createController({ product: { create }, store: { findMany } });

      await expect(call(controller.create(), createInput)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('B01'),
      });
      expect(create).not.toHaveBeenCalled();
    });

    it.each([
      ['a negative selling price', { sellingPrice: '-5.00' }],
      ['a negative reorder threshold', { reorderThresholds: [{ storeCode: 'B01', threshold: -1 }] }],
      ['a fractional reorder threshold', { reorderThresholds: [{ storeCode: 'B01', threshold: 1.5 }] }],
    ])('rejects %s before touching the database (MD-02)', async (_name, override) => {
      const create = vi.fn();
      const findMany = vi.fn();
      const controller = await createController({ product: { create }, store: { findMany } });

      await expect(call(controller.create(), { ...createInput, ...override })).rejects.toMatchObject(
        { code: 'BAD_REQUEST' },
      );
      expect(create).not.toHaveBeenCalled();
      expect(findMany).not.toHaveBeenCalled();
    });

    it('is restricted to admins at the API', () => {
      const roles = new Reflector().get(ROLES_KEY, ProductsController.prototype.create);

      expect(roles).toEqual(['ADMIN']);
    });
  });

  describe('setActive', () => {
    it('deactivates a product and returns it', async () => {
      const update = vi.fn().mockResolvedValue({ ...water, active: false });
      const controller = await createController({ product: { update } });

      const result = await call(controller.setActive(), { id: 'p1', active: false });

      expect(result).toMatchObject({ id: 'p1', active: false });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1' }, data: { active: false } }),
      );
    });

    it('reports an unknown product as not found', async () => {
      const update = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Record not found'), { code: 'P2025' }));
      const controller = await createController({ product: { update } });

      await expect(call(controller.setActive(), { id: 'nope', active: false })).rejects.toMatchObject(
        { code: 'NOT_FOUND', message: expect.stringContaining('ไม่พบสินค้า') },
      );
    });

    it('is restricted to admins at the API', () => {
      const roles = new Reflector().get(ROLES_KEY, ProductsController.prototype.setActive);

      expect(roles).toEqual(['ADMIN']);
    });
  });
});
