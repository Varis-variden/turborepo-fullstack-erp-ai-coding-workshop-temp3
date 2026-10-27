import type { User } from '@erp/contracts';
import { call } from '@orpc/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import { StockService } from '../inventory/stock.service.js';
import { createStockFixture, createTestPrisma } from '../test/postgres.js';
import { DUPLICATE_RECEIPT_MESSAGE, GoodsReceiptsController } from './goods-receipts.controller.js';

// Real Postgres, no stubs: the single transaction, the unique idempotency key and the stock
// movement are database behaviour that a stubbed Prisma cannot prove (AC-01, NFR-03).
describe('GoodsReceiptsController (real Postgres)', () => {
  let prisma: PrismaService;
  let controller: GoodsReceiptsController;
  const cleanups: (() => Promise<void>)[] = [];

  /** An Approved order of 20 packs for a store holding 10, all of it this spec's own rows. */
  async function approvedOrder() {
    const stock = await createStockFixture(prisma, 10);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: stock.storeId } });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: stock.productId } });
    const supplier = await prisma.supplier.create({
      data: { code: `IT-${store.code}`, name: 'Integration supplier' },
    });
    // The contract uppercases SKUs and order numbers, so this spec's own rows are uppercase.
    const sku = product.sku.toUpperCase();
    const order = await prisma.purchaseOrder.create({
      data: {
        number: `PO-IT-${store.code}`.toUpperCase(),
        status: 'APPROVED',
        supplierId: supplier.id,
        storeId: store.id,
        expectedReceiptDate: new Date('2026-02-01T00:00:00Z'),
        lines: {
          create: [
            {
              productId: product.id,
              sku,
              productName: product.name,
              unit: product.unit,
              quantity: 20,
              unitPrice: '45.00',
            },
          ],
        },
      },
    });
    cleanups.push(async () => {
      await prisma.auditLog.deleteMany({ where: { storeId: store.id } });
      await prisma.goodsReceipt.deleteMany({ where: { purchaseOrderId: order.id } });
      await prisma.purchaseOrder.delete({ where: { id: order.id } });
      await prisma.supplier.delete({ where: { id: supplier.id } });
      await stock.cleanup();
    });
    const staff: User = {
      id: `it-${store.code}`,
      email: 'staff@erp.local',
      name: 'Integration staff',
      role: 'STAFF',
      storeId: store.code,
    };
    return { stock, store, sku, order, staff };
  }

  beforeAll(() => {
    prisma = createTestPrisma();
    controller = new GoodsReceiptsController(prisma, new StockService(prisma));
  });

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('AC-01: receiving 8 of 20 with stock at 10 makes stock 18, outstanding 12, Partially Received, with exactly one receipt and one receipt movement', async () => {
    const { stock, sku, order, staff, store } = await approvedOrder();

    const receipt = await call(controller.confirm(staff), {
      purchaseOrderNumber: order.number,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ sku, quantity: 8 }],
    });

    expect(receipt).toMatchObject({ orderStatus: 'PARTIALLY_RECEIVED', storeCode: store.code });
    expect(receipt.number).toMatch(/^GR-\d{3,}$/);
    expect(await stock.balance()).toBe(18);

    const page = await call(controller.listOrders(staff), { page: 1, pageSize: 20 });
    expect(page.items).toMatchObject([
      {
        number: order.number,
        status: 'PARTIALLY_RECEIVED',
        lines: [{ ordered: 20, received: 8, outstanding: 12 }],
      },
    ]);

    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(1);
    const movements = await stock.movements();
    expect(movements).toMatchObject([
      {
        type: 'RECEIPT',
        quantityChange: 8,
        balanceBefore: 10,
        balanceAfter: 18,
        sourceType: 'GR',
        sourceId: receipt.id,
        actorId: staff.id,
      },
    ]);
    // The receipt is audited, in the same transaction.
    expect(await prisma.auditLog.findMany({ where: { storeId: store.id } })).toMatchObject([
      { action: 'GOODS_RECEIPT', sourceType: 'GR', sourceId: receipt.id, outcome: 'POSTED' },
    ]);
  });

  it('GR-03: receiving the remaining 12 completes the order and takes stock to 30', async () => {
    const { stock, sku, order, staff } = await approvedOrder();
    const receive = (quantity: number) =>
      call(controller.confirm(staff), {
        purchaseOrderNumber: order.number,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ sku, quantity }],
      });

    await receive(8);
    const second = await receive(12);

    expect(second.orderStatus).toBe('COMPLETED');
    expect(await stock.balance()).toBe(30);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'COMPLETED',
    );
  });

  it('NFR-03: the idempotency key is unique in the database, so a second use posts nothing', async () => {
    const { stock, sku, order, staff } = await approvedOrder();
    const input = {
      purchaseOrderNumber: order.number,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ sku, quantity: 8 }],
    };

    await call(controller.confirm(staff), input);
    await expect(call(controller.confirm(staff), input)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: DUPLICATE_RECEIPT_MESSAGE,
    });

    expect(await stock.balance()).toBe(18);
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(1);
    expect(await stock.movements()).toHaveLength(1);
  });
});
