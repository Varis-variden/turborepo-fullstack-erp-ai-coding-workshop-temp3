import type { User } from '@erp/contracts';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { StockService } from '../inventory/stock.service.js';
import { GoodsReceiptsController } from './goods-receipts.controller.js';

const staffB01: User = {
  id: 'u-b01',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STAFF',
  storeId: 'B01',
};

const KEY = '3f1d6a3e-5b0e-4a53-9a58-0d0f4f7f6a11';

// A PurchaseOrder row as the receiving handlers read it: store, supplier, lines, and for each
// line the quantities earlier receipts already brought in.
function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po1',
    number: 'PO-DEMO-001',
    status: 'APPROVED',
    expectedReceiptDate: new Date('2026-02-01T00:00:00Z'),
    supplier: { name: 'SupplyOne Co Ltd' },
    store: { id: 'st-b01', code: 'B01', name: 'Central Store' },
    lines: [
      {
        id: 'pol1',
        productId: 'p1',
        sku: 'SKU001',
        productName: 'Drinking water pack of 6',
        unit: 'pack',
        quantity: 20,
        receiptLines: [] as { quantity: number }[],
      },
    ],
    ...overrides,
  };
}

/**
 * A `StockService` whose transaction runs the work against a stubbed transaction client. `apply`
 * stands in for the ledger, which has its own specs; here it only has to be called correctly.
 */
function createStock(tx: Record<string, unknown>) {
  const apply = vi.fn(async (change: { quantityChange: number }) => ({
    id: `mov-${apply.mock.calls.length}`,
    ...change,
  }));
  const transact = vi.fn(async (work: (ledger: unknown) => Promise<unknown>) =>
    work({ tx, apply }),
  );
  return { stock: { transact } as unknown as StockService, apply, transact };
}

/** The transaction client a confirmation reads and writes through. */
function createTx(order: ReturnType<typeof orderRow> | null) {
  const goodsReceiptCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'gr1',
    createdAt: new Date('2026-02-02T03:04:05Z'),
    ...data,
    lines: (data.lines as { create: unknown[] }).create,
  }));
  const tx = {
    purchaseOrder: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue({}),
    },
    documentSequence: { upsert: vi.fn().mockResolvedValue({ lastValue: 1 }) },
    goodsReceipt: { create: goodsReceiptCreate },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return { tx, goodsReceiptCreate };
}

async function createController(stock: StockService, prisma: object = {}) {
  const moduleRef = await Test.createTestingModule({
    controllers: [GoodsReceiptsController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: StockService, useValue: stock },
    ],
  }).compile();
  return moduleRef.get(GoodsReceiptsController);
}

describe('GoodsReceiptsController.confirm', () => {
  it('AC-01: receiving 8 of 20 allocates GR-001, adds 8 to the store, and leaves the order Partially Received', async () => {
    const { tx, goodsReceiptCreate } = createTx(orderRow());
    const { stock, apply } = createStock(tx);
    const controller = await createController(stock);

    const receipt = await call(controller.confirm(staffB01), {
      purchaseOrderNumber: 'PO-DEMO-001',
      idempotencyKey: KEY,
      lines: [{ sku: 'SKU001', quantity: 8 }],
    });

    expect(receipt).toMatchObject({
      number: 'GR-001',
      purchaseOrderNumber: 'PO-DEMO-001',
      orderStatus: 'PARTIALLY_RECEIVED',
      storeCode: 'B01',
      lines: [{ sku: 'SKU001', name: 'Drinking water pack of 6', unit: 'pack', quantity: 8 }],
    });
    // Exactly one receipt, carrying the idempotency key and the destination store.
    expect(goodsReceiptCreate).toHaveBeenCalledTimes(1);
    expect(goodsReceiptCreate.mock.calls[0]![0].data).toMatchObject({
      number: 'GR-001',
      idempotencyKey: KEY,
      purchaseOrderId: 'po1',
      storeId: 'st-b01',
      receivedById: 'u-b01',
    });
    // Exactly one RECEIPT movement, against the receipt, for the receiving user.
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({
      productId: 'p1',
      storeId: 'st-b01',
      quantityChange: 8,
      type: 'RECEIPT',
      sourceType: 'GR',
      sourceId: 'gr1',
      actorId: 'u-b01',
    });
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po1' },
      data: { status: 'PARTIALLY_RECEIVED' },
    });
  });
  it('GR-03: receiving the rest of a partially received order completes it, counting earlier deliveries', async () => {
    const order = orderRow({ status: 'PARTIALLY_RECEIVED' });
    order.lines[0]!.receiptLines = [{ quantity: 8 }];
    const { tx } = createTx(order);
    const { stock, apply } = createStock(tx);
    const controller = await createController(stock);

    const receipt = await call(controller.confirm(staffB01), {
      purchaseOrderNumber: 'PO-DEMO-001',
      idempotencyKey: KEY,
      lines: [{ sku: 'SKU001', quantity: 12 }],
    });

    expect(receipt.orderStatus).toBe('COMPLETED');
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ quantityChange: 12 }));
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po1' },
      data: { status: 'COMPLETED' },
    });
  });

  it('NFR-03: the receipt is recorded in the audit log, in the same transaction', async () => {
    const { tx } = createTx(orderRow());
    const { stock } = createStock(tx);
    const controller = await createController(stock);

    await call(controller.confirm(staffB01), {
      purchaseOrderNumber: 'PO-DEMO-001',
      idempotencyKey: KEY,
      lines: [{ sku: 'SKU001', quantity: 8 }],
    });

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'GOODS_RECEIPT',
        actorId: 'u-b01',
        storeId: 'st-b01',
        sourceType: 'GR',
        sourceId: 'gr1',
        outcome: 'POSTED',
        detail: 'GR-001 against PO-DEMO-001',
      },
    });
  });

  describe('guards: nothing is written when the receipt is refused', () => {
    const receive = (quantity: number, sku = 'SKU001') => ({
      purchaseOrderNumber: 'PO-DEMO-001',
      idempotencyKey: KEY,
      lines: [{ sku, quantity }],
    });

    async function refused(
      order: ReturnType<typeof orderRow> | null,
      input: ReturnType<typeof receive>,
      user: User = staffB01,
    ) {
      const { tx, goodsReceiptCreate } = createTx(order);
      const { stock, apply } = createStock(tx);
      const controller = await createController(stock);

      const outcome = call(controller.confirm(user), input);
      await expect(outcome).rejects.toMatchObject({});
      const error = await outcome.catch((e: unknown) => e);
      expect(goodsReceiptCreate).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      return error;
    }

    it('rejects an order that does not exist', async () => {
      expect(await refused(null, receive(1))).toMatchObject({ code: 'NOT_FOUND' });
    });

    it.each(['DRAFT', 'COMPLETED'])('rejects an order that is %s', async (status) => {
      expect(await refused(orderRow({ status }), receive(1))).toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('PO-DEMO-001'),
      });
    });

    it('NFR-01: rejects a store employee receiving for another store', async () => {
      const staffB02: User = { ...staffB01, id: 'u-b02', storeId: 'B02' };
      expect(await refused(orderRow(), receive(1), staffB02)).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('GR-02: rejects a product that is not on the order', async () => {
      expect(await refused(orderRow(), receive(1, 'SKU002'))).toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('SKU002'),
      });
    });

    it('GR-02: rejects a receipt that takes the cumulative total above the ordered quantity', async () => {
      const order = orderRow({ status: 'PARTIALLY_RECEIVED' });
      order.lines[0]!.receiptLines = [{ quantity: 8 }];

      expect(await refused(order, receive(13))).toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('SKU001'),
      });
    });
  });

  it('GR-04: an idempotency key that was already used is refused without leaking database detail', async () => {
    const { tx, goodsReceiptCreate } = createTx(orderRow());
    goodsReceiptCreate.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`idempotencyKey`)'), {
        code: 'P2002',
        meta: { target: ['idempotencyKey'] },
      }),
    );
    const { stock } = createStock(tx);
    const controller = await createController(stock);

    const outcome = call(controller.confirm(staffB01), {
      purchaseOrderNumber: 'PO-DEMO-001',
      idempotencyKey: KEY,
      lines: [{ sku: 'SKU001', quantity: 8 }],
    });

    await expect(outcome).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(outcome).rejects.not.toHaveProperty('message', expect.stringContaining('Unique'));
  });

  it('is only for store employees (GR-01)', () => {
    const roles = new Reflector().get(ROLES_KEY, GoodsReceiptsController.prototype.confirm);
    expect(roles).toEqual(['STAFF']);
  });

  it('GR-02: a receipt with no quantity above zero is rejected by the contract', async () => {
    const { tx, goodsReceiptCreate } = createTx(orderRow());
    const { stock } = createStock(tx);
    const controller = await createController(stock);

    await expect(
      call(controller.confirm(staffB01), {
        purchaseOrderNumber: 'PO-DEMO-001',
        idempotencyKey: KEY,
        lines: [{ sku: 'SKU001', quantity: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(goodsReceiptCreate).not.toHaveBeenCalled();
  });
});

describe('GoodsReceiptsController.listOrders', () => {
  it('GR-01: shows ordered, previously received and outstanding quantities per line', async () => {
    const order = orderRow({ status: 'PARTIALLY_RECEIVED' });
    order.lines[0]!.receiptLines = [{ quantity: 5 }, { quantity: 3 }];
    const findMany = vi.fn().mockResolvedValue([order]);
    const count = vi.fn().mockResolvedValue(1);
    const { stock } = createStock({});
    const controller = await createController(stock, { purchaseOrder: { findMany, count } });

    const page = await call(controller.listOrders(staffB01), { page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      number: 'PO-DEMO-001',
      status: 'PARTIALLY_RECEIVED',
      supplierName: 'SupplyOne Co Ltd',
      storeCode: 'B01',
      storeName: 'Central Store',
      expectedReceiptDate: '2026-02-01',
      lines: [
        {
          id: 'pol1',
          sku: 'SKU001',
          name: 'Drinking water pack of 6',
          unit: 'pack',
          ordered: 20,
          received: 8,
          outstanding: 12,
        },
      ],
    });
  });

  it('GR-01: only Approved and Partially Received orders of the caller’s own store are offered', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const { stock } = createStock({});
    const controller = await createController(stock, { purchaseOrder: { findMany, count } });

    await call(controller.listOrders(staffB01), { page: 1, pageSize: 20 });

    const where = { status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] }, store: { code: 'B01' } };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('is only for store employees (GR-01)', () => {
    const roles = new Reflector().get(ROLES_KEY, GoodsReceiptsController.prototype.listOrders);
    expect(roles).toEqual(['STAFF']);
  });
});
