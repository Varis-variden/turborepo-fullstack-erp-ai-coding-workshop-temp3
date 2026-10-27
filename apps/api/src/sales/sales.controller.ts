import { Controller } from '@nestjs/common';
import { contract, type Sale, type User } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { allocateDocumentNumber } from '../documents/document-number.js';

/** Every read of a sale also loads its store and lines. */
const saleInclude = {
  store: { select: { code: true, name: true } },
  lines: { orderBy: { sku: 'asc' as const } },
} as const;

type SaleRow = {
  id: string;
  number: string;
  createdAt: Date;
  total: { toFixed(decimals: number): string };
  store: { code: string; name: string };
  lines: {
    id: string;
    sku: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: { toFixed(decimals: number): string };
    lineAmount: { toFixed(decimals: number): string };
  }[];
};

/** Prisma returns Decimal and Date; the contract exposes two-decimal strings and an ISO string. */
function toSale(row: SaleRow): Sale {
  return {
    id: row.id,
    number: row.number,
    storeCode: row.store.code,
    storeName: row.store.name,
    createdAt: row.createdAt.toISOString(),
    total: row.total.toFixed(2),
    lines: row.lines.map((line) => ({
      id: line.id,
      sku: line.sku,
      name: line.productName,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(2),
      lineAmount: line.lineAmount.toFixed(2),
    })),
  };
}

/**
 * Multiply a two-decimal money string by a whole quantity, exactly, in integer minor units so the
 * result never drifts the way floating-point multiplication would. Returns a two-decimal string.
 */
function multiplyMoney(unitPrice: string, quantity: number): string {
  const minorUnits = Math.round(Number(unitPrice) * 100) * quantity;
  return (minorUnits / 100).toFixed(2);
}

/** Sum a list of two-decimal money strings exactly, in integer minor units. */
function sumMoney(amounts: string[]): string {
  const minorUnits = amounts.reduce((total, amount) => total + Math.round(Number(amount) * 100), 0);
  return (minorUnits / 100).toFixed(2);
}

@Controller()
export class SalesController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles('STAFF')
  @Implement(contract.sales.list)
  list(@CurrentUser() user: User) {
    return implement(contract.sales.list).handler(async ({ input }) => {
      const { page, pageSize } = input;
      // A store employee only ever sees their own store's sales (NFR-01). User.storeId holds the
      // store code.
      const where = user.storeId ? { store: { code: user.storeId } } : {};
      const [items, total] = await Promise.all([
        this.prisma.sale.findMany({
          where,
          include: saleInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.sale.count({ where }),
      ]);
      return { items: items.map(toSale), page, pageSize, total };
    });
  }

  @Roles('STAFF')
  @Implement(contract.sales.create)
  create(@CurrentUser() user: User) {
    return implement(contract.sales.create).handler(async ({ input }) => {
      // The sale is scoped to the caller's assigned store, never one named in the input (SAL-01,
      // NFR-01). User.storeId holds the store code.
      const store = user.storeId
        ? await this.prisma.store.findUnique({ where: { code: user.storeId } })
        : null;
      if (!store) {
        throw new ORPCError('BAD_REQUEST', {
          message: 'บัญชีนี้ไม่ได้ผูกกับสาขา จึงสร้างรายการขายไม่ได้',
        });
      }

      const products = await this.prisma.product.findMany({
        where: { sku: { in: input.lines.map((line) => line.sku) } },
      });
      const productBySku = new Map(products.map((product) => [product.sku, product]));

      // Each line snapshots the product's current selling price: the caller cannot override it
      // (SAL-01). The line amount is quantity × unit price, the total the sum of the lines.
      const lines = input.lines.map((line) => {
        const product = productBySku.get(line.sku);
        if (!product) {
          throw new ORPCError('BAD_REQUEST', {
            message: `ไม่พบสินค้า ${line.sku} กรุณาตรวจสอบรหัสสินค้า (SKU)`,
          });
        }
        if (!product.active) {
          throw new ORPCError('BAD_REQUEST', {
            message: `สินค้า ${line.sku} ปิดใช้งานแล้ว ไม่สามารถเพิ่มในการขายใหม่ได้`,
          });
        }
        const unitPrice = product.sellingPrice.toFixed(2);
        return {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          unit: product.unit,
          quantity: line.quantity,
          unitPrice,
          lineAmount: multiplyMoney(unitPrice, line.quantity),
        };
      });
      const total = sumMoney(lines.map((line) => line.lineAmount));

      // The number is allocated in the same transaction that writes the sale. A draft sale is a
      // document only: no stock movement, no balance change (SAL-02).
      const created = await this.prisma.$transaction(async (tx) => {
        const number = await allocateDocumentNumber(tx, 'SAL');
        return tx.sale.create({
          data: {
            number,
            storeId: store.id,
            createdById: user.id,
            total,
            lines: { create: lines },
          },
          include: saleInclude,
        });
      });
      return toSale(created);
    });
  }
}
