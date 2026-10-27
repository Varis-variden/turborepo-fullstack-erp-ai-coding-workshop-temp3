import type { User } from '@erp/contracts';
import { call } from '@orpc/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import { StockService } from '../inventory/stock.service.js';
import { createStockFixture, createTestPrisma } from '../test/postgres.js';
import { GoodsReceiptsController } from './goods-receipts.controller.js';

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

  /**
   * A refused receipt must leave every business record as it was: the opening stock, no movement,
   * no receipt, the order still Approved, and no audit row. The guards assert this so that a
   * rejection is proven to post nothing (AC-03, AC-04), not merely to return an error.
   */
  async function expectNothingPosted(
    stock: Awaited<ReturnType<typeof approvedOrder>>['stock'],
    order: Awaited<ReturnType<typeof approvedOrder>>['order'],
  ) {
    expect(await stock.balance()).toBe(10);
    expect(await stock.movements()).toEqual([]);
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(0);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'APPROVED',
    );
    expect(await prisma.auditLog.findMany({ where: { storeId: stock.storeId } })).toEqual([]);
  }

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

  it('AC-03 (GR-02, GR-05): receiving 21 against an order of 20 is rejected, and nothing is posted — stock still 10, the order still Approved', async () => {
    const { stock, sku, order, staff } = await approvedOrder();

    await expect(
      call(controller.confirm(staff), {
        purchaseOrderNumber: order.number,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ sku, quantity: 21 }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining(sku) });

    await expectNothingPosted(stock, order);
  });

  it('AC-04 (GR-01, NFR-01): a store employee of another store receiving this order is rejected, and no business data changes', async () => {
    const { stock, sku, order, staff } = await approvedOrder();
    // A direct API request by an employee assigned to a different store than the order's. Store
    // scope is server-side, so the store code here just has to differ from the order's own
    // (freshly generated) code; `assertStoreScope` rejects any mismatch.
    const staffOtherStore: User = {
      ...staff,
      id: `${staff.id}-other-store`,
      storeId: `${staff.storeId}-OTHER`,
    };

    await expect(
      call(controller.confirm(staffOtherStore), {
        purchaseOrderNumber: order.number,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ sku, quantity: 8 }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expectNothingPosted(stock, order);
  });

  it('GR-05: two concurrent receipts of the full 20 cannot exceed the order — exactly one posts, total received is 20, stock rises to 30', async () => {
    const { stock, sku, order, staff } = await approvedOrder();
    const receiveAll = () =>
      call(controller.confirm(staff), {
        purchaseOrderNumber: order.number,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ sku, quantity: 20 }],
      });

    const results = await Promise.allSettled([receiveAll(), receiveAll()]);

    // The two requests together ask for 40 against a cap of 20: one commits all 20, the other is
    // refused. Serializable isolation decides the loser one of two ways — it re-reads the now-full
    // order and the cap rejects it (BAD_REQUEST), or it exhausts its one retry on the contended
    // balance row and is told to retry later (CONFLICT). Either way the cap is never exceeded.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({
      code: expect.stringMatching(/^(BAD_REQUEST|CONFLICT)$/),
    });

    expect(await stock.balance()).toBe(30);
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(1);
    expect(await stock.movements()).toMatchObject([{ quantityChange: 20, type: 'RECEIPT' }]);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'COMPLETED',
    );
  });

  it('AC-02 (GR-04): resending the identical request returns the original receipt, stock stays 18, received stays 8; a fresh key still posts', async () => {
    const { stock, sku, order, staff } = await approvedOrder();
    const request = {
      purchaseOrderNumber: order.number,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ sku, quantity: 8 }],
    };

    const first = await call(controller.confirm(staff), request);
    // The identical request again — same key, same lines — as a retry after a flaky network.
    const replay = await call(controller.confirm(staff), request);

    // The original receipt is handed back, not a new one.
    expect(replay).toEqual(first);
    // Stock, cumulative received, the single receipt and the single movement are all unchanged:
    // the resend counted nothing.
    expect(await stock.balance()).toBe(18);
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(1);
    expect(await stock.movements()).toHaveLength(1);
    const page = await call(controller.listOrders(staff), { page: 1, pageSize: 20 });
    expect(page.items[0]!.lines[0]).toMatchObject({ received: 8, outstanding: 12 });

    // A genuinely new receipt with a fresh key still posts: it is a different action (GR-04).
    const second = await call(controller.confirm(staff), {
      purchaseOrderNumber: order.number,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ sku, quantity: 4 }],
    });
    expect(second.id).not.toBe(first.id);
    expect(await stock.balance()).toBe(22);
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(2);
  });

  it('GR-04: resending the receipt that completed the order replays it, not the over-receipt refusal', async () => {
    const { stock, sku, order, staff } = await approvedOrder();
    // One receipt that takes the order all the way to Completed.
    const request = {
      purchaseOrderNumber: order.number,
      idempotencyKey: crypto.randomUUID(),
      lines: [{ sku, quantity: 20 }],
    };

    const completed = await call(controller.confirm(staff), request);
    expect(completed.orderStatus).toBe('COMPLETED');

    // Resending it would fail the over-receipt cap if it re-ran the confirmation (20 + 20 > 20).
    // Instead the key is recognised and the original receipt is replayed, stock unchanged.
    const replay = await call(controller.confirm(staff), request);
    expect(replay).toEqual(completed);
    expect(await stock.balance()).toBe(30);
    expect(await prisma.goodsReceipt.count({ where: { purchaseOrderId: order.id } })).toBe(1);
    expect(await stock.movements()).toHaveLength(1);
  });
});
