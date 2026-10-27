import type { User } from '@erp/contracts';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryController } from './inventory.controller.js';

const manager: User = {
  id: 'u-mgr',
  email: 'manager01@erp.local',
  name: 'Manager 01',
  role: 'MANAGER',
  storeId: null,
};
const staffB01: User = {
  id: 'u-b01',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STAFF',
  storeId: 'B01',
};

// A StockBalance row as Prisma returns it, with the product and store relations included.
const balance = (
  sku: string,
  name: string,
  quantity: number,
  threshold: number | null,
  storeCode = 'B01',
) => ({
  quantity,
  product: {
    id: sku.toLowerCase(),
    sku,
    name,
    unit: 'pack',
    reorderThresholds: threshold === null ? [] : [{ storeId: storeCode.toLowerCase(), threshold }],
  },
  store: { id: storeCode.toLowerCase(), code: storeCode },
});

async function createController(stubs: { stockBalance?: object; store?: object }) {
  const moduleRef = await Test.createTestingModule({
    controllers: [InventoryController],
    providers: [{ provide: PrismaService, useValue: { store: {}, stockBalance: {}, ...stubs } }],
  }).compile();
  return moduleRef.get(InventoryController);
}

describe('InventoryController.search', () => {
  it('returns quantity, unit, threshold and a low-stock flag per product in a store', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        balance('SKU001', 'Drinking water pack of 6', 10, 3),
        balance('SKU002', 'Tissue paper', 5, 3),
        balance('SKU003', 'Laundry detergent', 0, 3),
      ]);
    const count = vi.fn().mockResolvedValue(3);
    const controller = await createController({ stockBalance: { findMany, count } });

    const result = await call(controller.search(manager), { page: 1, pageSize: 20 });

    expect(result.total).toBe(3);
    expect(
      result.items.map((i) => [i.sku, i.unit, i.quantity, i.reorderThreshold, i.lowStock]),
    ).toEqual([
      ['SKU001', 'pack', 10, 3, false],
      ['SKU002', 'pack', 5, 3, false],
      ['SKU003', 'pack', 0, 3, true],
    ]);
  });

  it('flags low stock when quantity equals the threshold (at or below)', async () => {
    const findMany = vi.fn().mockResolvedValue([balance('SKU002', 'Tissue paper', 3, 3)]);
    const count = vi.fn().mockResolvedValue(1);
    const controller = await createController({ stockBalance: { findMany, count } });

    const result = await call(controller.search(manager), { page: 1, pageSize: 20 });

    expect(result.items[0]?.lowStock).toBe(true);
  });

  it('never flags low stock when no threshold is set for the store', async () => {
    const findMany = vi.fn().mockResolvedValue([balance('SKU001', 'Water', 0, null)]);
    const count = vi.fn().mockResolvedValue(1);
    const controller = await createController({ stockBalance: { findMany, count } });

    const result = await call(controller.search(manager), { page: 1, pageSize: 20 });

    expect(result.items[0]?.reorderThreshold).toBeNull();
    expect(result.items[0]?.lowStock).toBe(false);
  });

  it('searches SKU and product name, ignoring case', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({ stockBalance: { findMany, count } });

    await call(controller.search(manager), { page: 1, pageSize: 20, search: 'water' });

    expect(findMany.mock.calls[0]?.[0].where.product).toEqual({
      OR: [
        { sku: { contains: 'water', mode: 'insensitive' } },
        { name: { contains: 'water', mode: 'insensitive' } },
      ],
    });
  });

  it('narrows to one store when a store code is given', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({ stockBalance: { findMany, count } });

    await call(controller.search(manager), { page: 1, pageSize: 20, storeCode: 'B01' });

    expect(findMany.mock.calls[0]?.[0].where.store).toEqual({ code: 'B01' });
  });

  it('forces a store user to their own store, ignoring any other store they ask for', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({ stockBalance: { findMany, count } });

    await call(controller.search(staffB01), { page: 1, pageSize: 20, storeCode: 'B02' });

    expect(findMany.mock.calls[0]?.[0].where.store).toEqual({ code: 'B01' });
  });

  it('scopes a store user to their store even when they ask for no store', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({ stockBalance: { findMany, count } });

    await call(controller.search(staffB01), { page: 1, pageSize: 20 });

    expect(findMany.mock.calls[0]?.[0].where.store).toEqual({ code: 'B01' });
  });

  it('asks for the right slice on a later page', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({ stockBalance: { findMany, count } });

    await call(controller.search(manager), { page: 2, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
  });
});
