import { ORPCError } from '@orpc/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../database/prisma.service.js';
import { createStockFixture, createTestPrisma } from '../test/postgres.js';
import {
  INSUFFICIENT_STOCK_MESSAGE,
  STOCK_CONFLICT_MESSAGE,
  StockService,
  type StockLedger,
} from './stock.service.js';

// Real Postgres, no stubs: serialization failures and rollbacks are database behaviour that a
// stubbed Prisma cannot prove (INV-03, INV-04, AC-07).
describe('StockService (real Postgres)', () => {
  let prisma: PrismaService;
  let stock: StockService;
  const cleanups: (() => Promise<void>)[] = [];

  async function fixture(openingQuantity: number) {
    const created = await createStockFixture(prisma, openingQuantity);
    cleanups.push(created.cleanup);
    return created;
  }

  beforeAll(() => {
    prisma = createTestPrisma();
    stock = new StockService(prisma);
  });

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('AC-07: with stock at 10, two concurrent decrements of 7 leave exactly one success and a final stock of 3', async () => {
    const item = await fixture(10);
    // Both transactions must have read the balance of 10 before either writes: without this the
    // first can commit before the second starts and the race never happens.
    let arrived = 0;
    let release!: () => void;
    const bothHaveRead = new Promise<void>((resolve) => (release = resolve));
    const sell = () =>
      stock.transact(async (ledger) => {
        await ledger.tx.stockBalance.findUnique({
          where: { productId_storeId: { productId: item.productId, storeId: item.storeId } },
        });
        if (++arrived >= 2) release();
        await bothHaveRead;
        return ledger.apply({
          productId: item.productId,
          storeId: item.storeId,
          quantityChange: -7,
          type: 'SALE',
        });
      });

    const results = await Promise.allSettled([sell(), sell()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ORPCError);
    expect(rejected[0]!.reason).toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('สต็อก'),
    });
    expect(await item.balance()).toBe(3);
    expect(await item.movements()).toMatchObject([
      { quantityChange: -7, balanceBefore: 10, balanceAfter: 3, type: 'SALE' },
    ]);
  });

  it('INV-03: a rolled-back stock write leaves neither a movement nor a changed balance', async () => {
    const item = await fixture(10);

    await expect(
      stock.transact(async (ledger) => {
        await ledger.apply({
          productId: item.productId,
          storeId: item.storeId,
          quantityChange: -4,
          type: 'SALE',
        });
        throw new Error('the document failed to post');
      }),
    ).rejects.toThrow('the document failed to post');

    expect(await item.balance()).toBe(10);
    expect(await item.movements()).toEqual([]);
  });

  it('INV-03: a decrement larger than the balance is rejected with a Thai error and writes nothing', async () => {
    const item = await fixture(3);

    await expect(
      stock.transact((ledger) =>
        ledger.apply({
          productId: item.productId,
          storeId: item.storeId,
          quantityChange: -4,
          type: 'SALE',
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: INSUFFICIENT_STOCK_MESSAGE });

    expect(await item.balance()).toBe(3);
    expect(await item.movements()).toEqual([]);
  });

  /**
   * Makes the open transaction lose a race: it reads the balance (taking its snapshot), then a
   * second connection changes that balance and commits, so the write that follows must fail.
   */
  async function loseTheRace(
    item: Awaited<ReturnType<typeof fixture>>,
    ledger: StockLedger,
  ): Promise<void> {
    await ledger.tx.stockBalance.findUnique({
      where: { productId_storeId: { productId: item.productId, storeId: item.storeId } },
    });
    await prisma.stockBalance.update({
      where: { productId_storeId: { productId: item.productId, storeId: item.storeId } },
      data: { quantity: { increment: 1 } },
    });
  }

  it('INV-04: a serialization conflict is retried once against the new balance', async () => {
    const item = await fixture(10);
    let attempts = 0;

    await stock.transact(async (ledger) => {
      attempts++;
      if (attempts === 1) await loseTheRace(item, ledger);
      return ledger.apply({
        productId: item.productId,
        storeId: item.storeId,
        quantityChange: -7,
        type: 'SALE',
      });
    });

    expect(attempts).toBe(2);
    // 10, plus the competing +1, minus 7: the retry validated and wrote against the latest balance.
    expect(await item.balance()).toBe(4);
    expect(await item.movements()).toMatchObject([
      { quantityChange: -7, balanceBefore: 11, balanceAfter: 4 },
    ]);
  });

  it('INV-04: a second serialization conflict is rejected with a Thai error, after exactly one retry', async () => {
    const item = await fixture(10);
    let attempts = 0;

    await expect(
      stock.transact(async (ledger) => {
        attempts++;
        await loseTheRace(item, ledger);
        return ledger.apply({
          productId: item.productId,
          storeId: item.storeId,
          quantityChange: -7,
          type: 'SALE',
        });
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: STOCK_CONFLICT_MESSAGE });

    expect(attempts).toBe(2);
    expect(await item.movements()).toEqual([]);
  });
});
