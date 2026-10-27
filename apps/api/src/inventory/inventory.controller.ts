import { Controller } from '@nestjs/common';
import { contract, type StockAdjustmentResult, type StockItem, type User } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { assertStoreScope } from '../auth/store-scope.js';
import { PrismaService } from '../database/prisma.service.js';
import { INSUFFICIENT_STOCK_MESSAGE, StockService } from './stock.service.js';

/**
 * A StockBalance read with the product (plus every reorder threshold it has) and the store.
 * Thresholds live on ProductReorderThreshold keyed by product + store; `toStockItem` picks the
 * row for this balance's store, reporting `null` when the product has no threshold there.
 */
const stockInclude = {
  product: {
    select: {
      id: true,
      sku: true,
      name: true,
      unit: true,
      reorderThresholds: { select: { storeId: true, threshold: true } },
    },
  },
  store: { select: { id: true, code: true } },
} as const;

type StockRow = {
  quantity: number;
  product: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    reorderThresholds: { storeId: string; threshold: number }[];
  };
  store: { id: string; code: string };
};

/** Prisma returns the balance with relations; the contract exposes the derived low-stock view. */
function toStockItem(row: StockRow): StockItem {
  const threshold =
    row.product.reorderThresholds.find((t) => t.storeId === row.store.id)?.threshold ?? null;
  return {
    productId: row.product.id,
    sku: row.product.sku,
    name: row.product.name,
    unit: row.product.unit,
    storeCode: row.store.code,
    quantity: row.quantity,
    reorderThreshold: threshold,
    lowStock: threshold !== null && row.quantity <= threshold,
  };
}

@Controller()
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  @Implement(contract.inventory.search)
  search(@CurrentUser() user: User) {
    return implement(contract.inventory.search).handler(async ({ input }) => {
      const { page, pageSize, search, storeCode } = input;

      // Store scope is enforced here, not in the UI (NFR-01). A store user asking for another
      // store is rejected with FORBIDDEN, not silently narrowed; asking for no store (or their
      // own) scopes to their store. An unassigned user (MANAGER/ADMIN) sees every store, optionally
      // narrowed by the requested store code.
      if (storeCode) assertStoreScope(user, storeCode);
      const effectiveStoreCode = user.storeId ?? storeCode;

      const where = {
        ...(effectiveStoreCode ? { store: { code: effectiveStoreCode } } : {}),
        ...(search
          ? {
              product: {
                OR: [
                  { sku: { contains: search, mode: 'insensitive' as const } },
                  { name: { contains: search, mode: 'insensitive' as const } },
                ],
              },
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        this.prisma.stockBalance.findMany({
          where,
          include: stockInclude,
          orderBy: [{ store: { code: 'asc' } }, { product: { sku: 'asc' } }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.stockBalance.count({ where }),
      ]);

      return { items: rows.map(toStockItem), page, pageSize, total };
    });
  }

  @Roles('MANAGER')
  @Implement(contract.inventory.adjust)
  adjust(@CurrentUser() user: User) {
    return implement(contract.inventory.adjust).handler(
      async ({ input }): Promise<StockAdjustmentResult> => {
        const { sku, storeCode, quantityChange, reason } = input;

        const [product, store] = await Promise.all([
          this.prisma.product.findUnique({ where: { sku } }),
          this.prisma.store.findUnique({ where: { code: storeCode } }),
        ]);
        if (!product) {
          throw new ORPCError('BAD_REQUEST', {
            message: `ไม่พบสินค้า ${sku} กรุณาตรวจสอบรหัสสินค้า (SKU)`,
          });
        }
        if (!product.active) {
          throw new ORPCError('BAD_REQUEST', {
            message: `สินค้า ${sku} ปิดใช้งานแล้ว ไม่สามารถปรับสต็อกได้`,
          });
        }
        if (!store) {
          throw new ORPCError('BAD_REQUEST', {
            message: `ไม่พบสาขา ${storeCode} กรุณาตรวจสอบรหัสสาขา`,
          });
        }

        // A manager has storeId === null, so this never rejects today; it keeps the write path
        // honest the moment a store-bound role is allowed to adjust (NFR-01). User.storeId holds
        // the store code, so scope is checked against the code, as stock search does.
        assertStoreScope(user, store.code);

        try {
          // The movement, the balance and the POSTED audit row post together or roll back together
          // (INV-03): if the ledger rejects an over-reduction, the audit row written here is
          // discarded with the transaction, and the REJECTED row is written below instead.
          return await this.stock.transact(async (ledger) => {
            const movement = await ledger.apply({
              productId: product.id,
              storeId: store.id,
              quantityChange,
              type: 'ADJUSTMENT',
              sourceType: 'ADJUSTMENT',
              actorId: user.id,
            });
            await ledger.tx.auditLog.create({
              data: {
                action: 'STOCK_ADJUSTMENT',
                actorId: user.id,
                storeId: store.id,
                sourceType: 'ADJUSTMENT',
                sourceId: movement.id,
                outcome: 'POSTED',
                detail: reason,
              },
            });
            return {
              sku: product.sku,
              storeCode: store.code,
              quantityChange: movement.quantityChange,
              balanceBefore: movement.balanceBefore,
              balanceAfter: movement.balanceAfter,
            };
          });
        } catch (error) {
          // Only a stock-rule rejection (an over-reduction below the available balance) is an
          // audited REJECTED outcome (NFR-03). A serialization CONFLICT is contention ("try
          // again") and any other failure is an infrastructure error; neither is a manager's
          // adjustment being rejected on its merits, so they propagate without a misleading audit
          // row. Validation misses (unknown/inactive SKU, unknown store) throw BAD_REQUEST before
          // this try, so they are likewise not audited: a malformed request is not an
          // executed-and-rejected adjustment.
          const isOverReduction =
            error instanceof ORPCError && error.message === INSUFFICIENT_STOCK_MESSAGE;
          if (!isOverReduction) throw error;

          // The rejection is itself audited: outcome REJECTED, no source document because no
          // movement was written. Writing the audit row must never mask the rejection the caller
          // needs to see, so a failure here is logged and the original error still surfaces.
          try {
            await this.prisma.auditLog.create({
              data: {
                action: 'STOCK_ADJUSTMENT',
                actorId: user.id,
                storeId: store.id,
                sourceType: 'ADJUSTMENT',
                sourceId: null,
                outcome: 'REJECTED',
                detail: reason,
              },
            });
          } catch (auditError) {
            console.error('Failed to write REJECTED audit row for stock adjustment', auditError);
          }
          throw error;
        }
      },
    );
  }
}
