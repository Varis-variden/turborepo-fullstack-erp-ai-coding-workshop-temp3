import { Injectable } from '@nestjs/common';
import { Prisma, type StockMovement, type StockMovementType } from '@erp/database';
import { ORPCError } from '@orpc/server';
import { PrismaService } from '../database/prisma.service.js';

/** One signed change to one product's balance in one store. */
export type StockChange = {
  productId: string;
  storeId: string;
  /** Positive to increase, negative to decrease. Whole units, never zero. */
  quantityChange: number;
  type: StockMovementType;
  /** The document that caused the movement, e.g. "SAL" or "GR", plus its id. */
  sourceType?: string;
  sourceId?: string;
  actorId?: string;
};

/** What a `transact` callback works with: the open transaction and the one way to move stock. */
export type StockLedger = {
  /** The transaction client, so a document can be posted in the same transaction as its stock. */
  tx: Prisma.TransactionClient;
  /**
   * Re-reads the authoritative balance inside the transaction, rejects a change that would take
   * it below zero, then writes the movement and the new balance together.
   */
  apply(change: StockChange): Promise<StockMovement>;
};

export const INSUFFICIENT_STOCK_MESSAGE =
  'สต็อกสินค้าไม่เพียงพอ ยอดคงเหลือไม่พอสำหรับรายการนี้ กรุณาตรวจสอบยอดล่าสุดแล้วลองใหม่';
export const STOCK_CONFLICT_MESSAGE =
  'มีผู้ใช้อื่นกำลังเปลี่ยนแปลงสต็อกสินค้านี้พร้อมกัน ระบบไม่สามารถบันทึกรายการได้ กรุณาลองใหม่อีกครั้ง';

/** Prisma's "write conflict or deadlock, retry the transaction" code (a Postgres 40001). */
const SERIALIZATION_FAILURE = 'P2034';
/** One try plus one retry (INV-04). */
const MAX_ATTEMPTS = 2;

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === SERIALIZATION_FAILURE
  );
}

/**
 * The only way stock changes. Every change runs in a Serializable transaction that re-reads the
 * balance it validates against, so a client-supplied balance is never trusted (INV-04) and the
 * movement, the balance and anything else the caller writes through `ledger.tx` post together or
 * roll back together (INV-03). When Postgres aborts the loser of a race, the work is retried once
 * against the new balance; a second conflict is rejected with a Thai error.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async transact<T>(work: (ledger: StockLedger) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          (tx) => work({ tx, apply: (change) => this.apply(tx, change) }),
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (!isSerializationFailure(error)) throw error;
        if (attempt >= MAX_ATTEMPTS) {
          throw new ORPCError('CONFLICT', { message: STOCK_CONFLICT_MESSAGE });
        }
      }
    }
  }

  private async apply(tx: Prisma.TransactionClient, change: StockChange): Promise<StockMovement> {
    const { productId, storeId, quantityChange } = change;
    const key = { productId_storeId: { productId, storeId } };

    const current = await tx.stockBalance.findUnique({ where: key });
    const balanceBefore = current?.quantity ?? 0;
    const balanceAfter = balanceBefore + quantityChange;
    if (balanceAfter < 0) {
      throw new ORPCError('CONFLICT', { message: INSUFFICIENT_STOCK_MESSAGE });
    }

    if (current) {
      await tx.stockBalance.update({ where: key, data: { quantity: balanceAfter } });
    } else {
      await tx.stockBalance.create({ data: { productId, storeId, quantity: balanceAfter } });
    }

    return tx.stockMovement.create({
      data: {
        productId,
        storeId,
        quantityChange,
        balanceBefore,
        balanceAfter,
        type: change.type,
        sourceType: change.sourceType,
        sourceId: change.sourceId,
        actorId: change.actorId,
      },
    });
  }
}
