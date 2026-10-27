import { Controller } from '@nestjs/common';
import { contract, type PurchaseOrder, type User } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { allocateDocumentNumber } from '../documents/document-number.js';

/** Every read of an order also loads its supplier, store and lines. */
const orderInclude = {
  supplier: { select: { code: true, name: true } },
  store: { select: { code: true, name: true } },
  lines: { orderBy: { sku: 'asc' as const } },
} as const;

type OrderRow = {
  id: string;
  number: string;
  status: 'DRAFT';
  expectedReceiptDate: Date;
  createdAt: Date;
  supplier: { code: string; name: string };
  store: { code: string; name: string };
  lines: {
    id: string;
    sku: string;
    productName: string;
    unit: string;
    quantity: number;
    unitPrice: { toFixed(decimals: number): string };
  }[];
};

/** Prisma returns Decimal and Date; the contract exposes a two-decimal string, a date and an ISO string. */
function toPurchaseOrder(row: OrderRow): PurchaseOrder {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    supplierCode: row.supplier.code,
    supplierName: row.supplier.name,
    storeCode: row.store.code,
    storeName: row.store.name,
    expectedReceiptDate: row.expectedReceiptDate.toISOString().slice(0, 10),
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      sku: line.sku,
      name: line.productName,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toFixed(2),
    })),
  };
}

@Controller()
export class PurchaseOrdersController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles('PURCHASING', 'MANAGER', 'ADMIN')
  @Implement(contract.purchaseOrders.list)
  list() {
    return implement(contract.purchaseOrders.list).handler(async ({ input }) => {
      const { page, pageSize } = input;
      const [items, total] = await Promise.all([
        this.prisma.purchaseOrder.findMany({
          include: orderInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.purchaseOrder.count(),
      ]);
      return { items: items.map(toPurchaseOrder), page, pageSize, total };
    });
  }

  @Roles('PURCHASING')
  @Implement(contract.purchaseOrders.create)
  create(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.create).handler(async ({ input }) => {
      const [supplier, store, products] = await Promise.all([
        this.prisma.supplier.findUnique({ where: { code: input.supplierCode } }),
        this.prisma.store.findUnique({ where: { code: input.storeCode } }),
        this.prisma.product.findMany({ where: { sku: { in: input.lines.map((l) => l.sku) } } }),
      ]);
      if (!supplier) {
        throw new ORPCError('BAD_REQUEST', {
          message: `ไม่พบผู้จัดจำหน่าย ${input.supplierCode} กรุณาตรวจสอบรหัสผู้จัดจำหน่าย`,
        });
      }
      if (!store) {
        throw new ORPCError('BAD_REQUEST', {
          message: `ไม่พบสาขา ${input.storeCode} กรุณาตรวจสอบรหัสสาขา`,
        });
      }

      const productBySku = new Map(products.map((product) => [product.sku, product]));
      const lines = input.lines.map((line) => {
        const product = productBySku.get(line.sku);
        if (!product) {
          throw new ORPCError('BAD_REQUEST', {
            message: `ไม่พบสินค้า ${line.sku} กรุณาตรวจสอบรหัสสินค้า (SKU)`,
          });
        }
        if (!product.active) {
          throw new ORPCError('BAD_REQUEST', {
            message: `สินค้า ${line.sku} ปิดใช้งานแล้ว ไม่สามารถเพิ่มในใบสั่งซื้อใหม่ได้`,
          });
        }
        // The snapshot: what the product was called and counted in when the order was made.
        return {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          unit: product.unit,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        };
      });

      // The number is allocated in the same transaction that writes the order.
      const created = await this.prisma.$transaction(async (tx) => {
        const number = await allocateDocumentNumber(tx, 'PO');
        return tx.purchaseOrder.create({
          data: {
            number,
            supplierId: supplier.id,
            storeId: store.id,
            expectedReceiptDate: new Date(`${input.expectedReceiptDate}T00:00:00Z`),
            createdById: user.id,
            lines: { create: lines },
          },
          include: orderInclude,
        });
      });
      return toPurchaseOrder(created);
    });
  }
}
