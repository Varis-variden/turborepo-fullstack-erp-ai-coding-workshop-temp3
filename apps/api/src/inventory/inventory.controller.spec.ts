import type { User } from '@erp/contracts';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { InventoryController } from './inventory.controller.js';
import { INSUFFICIENT_STOCK_MESSAGE, StockService } from './stock.service.js';

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

async function createController(
  stubs: { stockBalance?: object; store?: object; product?: object; auditLog?: object },
  stockService: Partial<StockService> = {},
) {
  const moduleRef = await Test.createTestingModule({
    controllers: [InventoryController],
    providers: [
      {
        provide: PrismaService,
        useValue: { store: {}, stockBalance: {}, product: {}, auditLog: {}, ...stubs },
      },
      { provide: StockService, useValue: stockService },
    ],
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

  it('forces a store user to their own store when they ask for no store', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({ stockBalance: { findMany, count } });

    await call(controller.search(staffB01), { page: 1, pageSize: 20 });

    expect(findMany.mock.calls[0]?.[0].where.store).toEqual({ code: 'B01' });
  });

  it('lets a store user ask for their own store explicitly', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({ stockBalance: { findMany, count } });

    await call(controller.search(staffB01), { page: 1, pageSize: 20, storeCode: 'B01' });

    expect(findMany.mock.calls[0]?.[0].where.store).toEqual({ code: 'B01' });
  });

  it('rejects a store user asking for another store with FORBIDDEN, and queries nothing', async () => {
    const findMany = vi.fn();
    const count = vi.fn();
    const controller = await createController({ stockBalance: { findMany, count } });

    await expect(
      call(controller.search(staffB01), { page: 1, pageSize: 20, storeCode: 'B02' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('asks for the right slice on a later page', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({ stockBalance: { findMany, count } });

    await call(controller.search(manager), { page: 2, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
  });
});

const water = {
  id: 'p1',
  sku: 'SKU001',
  name: 'Drinking water pack of 6',
  unit: 'pack',
  active: true,
};
const storeB01 = { id: 'st-b01', code: 'B01', name: 'Central Store' };

/**
 * A StockService stand-in. `transact(work)` runs the work callback with a ledger whose `apply`
 * is the supplied stub and whose `tx.auditLog.create` is `auditCreate`, mirroring how the real
 * service exposes the open transaction. When `apply` rejects, the callback throws and nothing it
 * wrote through `tx` is kept, exactly as a rolled-back transaction behaves.
 */
function stubStockService(apply: ReturnType<typeof vi.fn>, auditCreate: ReturnType<typeof vi.fn>) {
  return {
    transact: vi.fn(async (work: (ledger: unknown) => Promise<unknown>) =>
      work({ tx: { auditLog: { create: auditCreate } }, apply }),
    ),
  } as unknown as StockService;
}

const adjustInput = { sku: 'SKU001', storeCode: 'B01', quantityChange: -4, reason: 'นับสต็อกใหม่' };

describe('InventoryController.adjust', () => {
  it('posts an ADJUSTMENT movement for the product and store and returns the new balance', async () => {
    const movement = {
      id: 'm1',
      quantityChange: 5,
      balanceBefore: 10,
      balanceAfter: 15,
    };
    const apply = vi.fn().mockResolvedValue(movement);
    const auditCreate = vi.fn().mockResolvedValue({});
    const controller = await createController(
      {
        product: { findUnique: vi.fn().mockResolvedValue(water) },
        store: { findUnique: vi.fn().mockResolvedValue(storeB01) },
      },
      stubStockService(apply, auditCreate),
    );

    const result = await call(controller.adjust(manager), {
      sku: 'SKU001',
      storeCode: 'B01',
      quantityChange: 5,
      reason: 'นับสต็อกใหม่',
    });

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'p1',
        storeId: 'st-b01',
        quantityChange: 5,
        type: 'ADJUSTMENT',
        actorId: 'u-mgr',
      }),
    );
    expect(result).toEqual({
      sku: 'SKU001',
      storeCode: 'B01',
      quantityChange: 5,
      balanceBefore: 10,
      balanceAfter: 15,
    });
  });

  it('records a POSTED audit entry referencing the movement, with the reason as detail', async () => {
    const movement = { id: 'm1', quantityChange: -4, balanceBefore: 10, balanceAfter: 6 };
    const apply = vi.fn().mockResolvedValue(movement);
    const auditCreate = vi.fn().mockResolvedValue({});
    const controller = await createController(
      {
        product: { findUnique: vi.fn().mockResolvedValue(water) },
        store: { findUnique: vi.fn().mockResolvedValue(storeB01) },
      },
      stubStockService(apply, auditCreate),
    );

    await call(controller.adjust(manager), adjustInput);

    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        action: 'STOCK_ADJUSTMENT',
        actorId: 'u-mgr',
        storeId: 'st-b01',
        sourceType: 'ADJUSTMENT',
        sourceId: 'm1',
        outcome: 'POSTED',
        detail: 'นับสต็อกใหม่',
      },
    });
  });

  it('rejects a reduction greater than the available balance, writes no movement, and records a REJECTED audit entry', async () => {
    const apply = vi
      .fn()
      .mockRejectedValue(
        new (await import('@orpc/server')).ORPCError('CONFLICT', {
          message: INSUFFICIENT_STOCK_MESSAGE,
        }),
      );
    const auditCreate = vi.fn().mockResolvedValue({});
    const rejectedAuditCreate = vi.fn().mockResolvedValue({});
    const controller = await createController(
      {
        product: { findUnique: vi.fn().mockResolvedValue(water) },
        store: { findUnique: vi.fn().mockResolvedValue(storeB01) },
        auditLog: { create: rejectedAuditCreate },
      },
      stubStockService(apply, auditCreate),
    );

    await expect(
      call(controller.adjust(manager), {
        sku: 'SKU001',
        storeCode: 'B01',
        quantityChange: -999,
        reason: 'ของเสีย',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // No audit row was written inside the rolled-back transaction.
    expect(auditCreate).not.toHaveBeenCalled();
    // A REJECTED audit row was written outside it, with no source document (no movement).
    expect(rejectedAuditCreate).toHaveBeenCalledWith({
      data: {
        action: 'STOCK_ADJUSTMENT',
        actorId: 'u-mgr',
        storeId: 'st-b01',
        sourceType: 'ADJUSTMENT',
        sourceId: null,
        outcome: 'REJECTED',
        detail: 'ของเสีย',
      },
    });
  });

  it('rejects an unknown SKU with BAD_REQUEST before touching the ledger', async () => {
    const apply = vi.fn();
    const auditCreate = vi.fn();
    const controller = await createController(
      {
        product: { findUnique: vi.fn().mockResolvedValue(null) },
        store: { findUnique: vi.fn().mockResolvedValue(storeB01) },
      },
      stubStockService(apply, auditCreate),
    );

    await expect(call(controller.adjust(manager), adjustInput)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects an unknown store with BAD_REQUEST before touching the ledger', async () => {
    const apply = vi.fn();
    const auditCreate = vi.fn();
    const controller = await createController(
      {
        product: { findUnique: vi.fn().mockResolvedValue(water) },
        store: { findUnique: vi.fn().mockResolvedValue(null) },
      },
      stubStockService(apply, auditCreate),
    );

    await expect(call(controller.adjust(manager), adjustInput)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('rejects adjusting an inactive product with BAD_REQUEST', async () => {
    const apply = vi.fn();
    const auditCreate = vi.fn();
    const controller = await createController(
      {
        product: { findUnique: vi.fn().mockResolvedValue({ ...water, active: false }) },
        store: { findUnique: vi.fn().mockResolvedValue(storeB01) },
      },
      stubStockService(apply, auditCreate),
    );

    await expect(call(controller.adjust(manager), adjustInput)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(apply).not.toHaveBeenCalled();
  });
});
