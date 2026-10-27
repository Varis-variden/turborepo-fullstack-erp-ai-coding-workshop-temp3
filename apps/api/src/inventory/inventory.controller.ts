import { Controller } from '@nestjs/common';
import { contract, type StockItem, type User } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser } from '../auth/auth.decorators.js';
import { assertStoreScope } from '../auth/store-scope.js';
import { PrismaService } from '../database/prisma.service.js';

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
  constructor(private readonly prisma: PrismaService) {}

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
}
