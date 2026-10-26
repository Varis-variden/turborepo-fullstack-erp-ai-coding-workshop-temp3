import { Controller } from '@nestjs/common';
import { contract, type Product } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { isRecordNotFoundError, isUniqueConstraintError } from '../database/prisma-errors.js';

/** Every read of a product also loads its thresholds with the store code they belong to. */
const productInclude = {
  reorderThresholds: { include: { store: { select: { code: true } } } },
} as const;

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  sellingPrice: { toFixed(decimals: number): string };
  active: boolean;
  createdAt: Date;
  reorderThresholds: { threshold: number; store: { code: string } }[];
};

/** Prisma returns Decimal and Date; the contract exposes a two-decimal string and an ISO string. */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    sellingPrice: row.sellingPrice.toFixed(2),
    active: row.active,
    reorderThresholds: row.reorderThresholds.map(({ threshold, store }) => ({
      storeCode: store.code,
      threshold,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

@Controller()
export class ProductsController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.products.list)
  list() {
    return implement(contract.products.list).handler(async ({ input }) => {
      const { page, pageSize, status, search } = input;
      const where = {
        ...(status === 'ACTIVE' ? { active: true } : {}),
        ...(search
          ? {
              OR: [
                { sku: { contains: search, mode: 'insensitive' as const } },
                { name: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include: productInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.product.count({ where }),
      ]);
      return { items: items.map(toProduct), page, pageSize, total };
    });
  }

  @Roles('ADMIN')
  @Implement(contract.products.create)
  create() {
    return implement(contract.products.create).handler(async ({ input }) => {
      const { reorderThresholds, ...fields } = input;
      const storeIds = await this.resolveStoreIds(reorderThresholds.map((t) => t.storeCode));

      try {
        const created = await this.prisma.product.create({
          data: {
            ...fields,
            reorderThresholds: {
              create: reorderThresholds.map(({ storeCode, threshold }) => ({
                storeId: storeIds.get(storeCode) as string,
                threshold,
              })),
            },
          },
          include: productInclude,
        });
        return toProduct(created);
      } catch (error) {
        if (isUniqueConstraintError(error, 'sku')) {
          throw new ORPCError('CONFLICT', {
            message: `รหัสสินค้า (SKU) ${input.sku} ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น`,
          });
        }
        throw error;
      }
    });
  }

  @Roles('ADMIN')
  @Implement(contract.products.setActive)
  setActive() {
    return implement(contract.products.setActive).handler(async ({ input }) => {
      try {
        const updated = await this.prisma.product.update({
          where: { id: input.id },
          data: { active: input.active },
          include: productInclude,
        });
        return toProduct(updated);
      } catch (error) {
        if (isRecordNotFoundError(error)) {
          throw new ORPCError('NOT_FOUND', { message: 'ไม่พบสินค้านี้ กรุณารีเฟรชหน้าจอ' });
        }
        throw error;
      }
    });
  }

  /** Map store codes to ids, rejecting any code that is not a known store. */
  private async resolveStoreIds(codes: string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();

    const stores = await this.prisma.store.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const ids = new Map(stores.map((store) => [store.code, store.id]));
    const unknown = codes.filter((code) => !ids.has(code));
    if (unknown.length > 0) {
      throw new ORPCError('BAD_REQUEST', {
        message: `ไม่พบสาขา ${unknown.join(', ')} กรุณาตรวจสอบรหัสสาขา`,
      });
    }
    return ids;
  }
}
