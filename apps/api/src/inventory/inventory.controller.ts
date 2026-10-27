import { Controller } from '@nestjs/common';
import { contract, type StockItem, type User } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * A StockBalance read with the product (and its reorder threshold for this store) and the store.
 * The threshold lives on ProductReorderThreshold keyed by product + store; we load the single row
 * for this balance's store so a product with no threshold in this store reports `null`.
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

      // Store scope is enforced here, not in the UI: a store user only ever sees their own store,
      // whatever store they ask for (NFR-01). An unassigned user (MANAGER/ADMIN) sees every store,
      // optionally narrowed by the requested store code.
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
