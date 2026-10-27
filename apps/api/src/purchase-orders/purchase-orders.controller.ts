import { Controller } from '@nestjs/common';
import { contract, type PurchaseOrder, type User } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { assertStoreScope } from '../auth/store-scope.js';
import { allocateDocumentNumber } from '../documents/document-number.js';

/** Every read of an order also loads its supplier, store and lines. */
const orderInclude = {
  supplier: { select: { code: true, name: true } },
  store: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { sku: 'asc' as const } },
} as const;

type OrderRow = {
  id: string;
  number: string;
  status: PurchaseOrder['status'];
  reason: string | null;
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
    reason: row.reason,
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

type Status = PurchaseOrder['status'];

/** Status names as the Thai UI calls them, for the "cannot do this in this status" message. */
const STATUS_LABEL: Record<Status, string> = {
  DRAFT: 'ฉบับร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
  PARTIALLY_RECEIVED: 'รับสินค้าบางส่วน',
  COMPLETED: 'รับสินค้าครบแล้ว',
};

/**
 * One row-set of the transition table (PO-02..PO-04) per route. Every other (status, action)
 * pair is illegal and answered with CONFLICT. The receiving transitions (APPROVED and
 * PARTIALLY_RECEIVED -> PARTIALLY_RECEIVED / COMPLETED) belong to goods receipt, not to a route
 * here, so no route can reach them: they are rejected at the API like any other illegal move.
 */
const TRANSITIONS = {
  submit: { from: ['DRAFT'], to: 'PENDING_APPROVAL', verb: 'ส่งขออนุมัติ' },
  approve: { from: ['PENDING_APPROVAL'], to: 'APPROVED', verb: 'อนุมัติ' },
  reject: { from: ['PENDING_APPROVAL'], to: 'REJECTED', verb: 'ปฏิเสธ' },
  cancel: { from: ['DRAFT', 'PENDING_APPROVAL'], to: 'CANCELLED', verb: 'ยกเลิก' },
} as const satisfies Record<string, { from: readonly Status[]; to: Status; verb: string }>;

type TransitionName = keyof typeof TRANSITIONS;

/** Only approvals and rejections are audited (NFR-03). */
const AUDITED = {
  approve: 'PURCHASE_ORDER_APPROVED',
  reject: 'PURCHASE_ORDER_REJECTED',
} as const;

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

  @Roles('PURCHASING')
  @Implement(contract.purchaseOrders.submit)
  submit(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.submit).handler(({ input }) =>
      this.transition('submit', input.id, user),
    );
  }

  @Roles('MANAGER')
  @Implement(contract.purchaseOrders.approve)
  approve(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.approve).handler(({ input }) =>
      this.transition('approve', input.id, user),
    );
  }

  @Roles('MANAGER')
  @Implement(contract.purchaseOrders.reject)
  reject(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.reject).handler(({ input }) =>
      this.transition('reject', input.id, user, input.reason),
    );
  }

  // The creator (a purchasing officer) or any manager; a purchasing officer only for their own order.
  @Roles('PURCHASING', 'MANAGER')
  @Implement(contract.purchaseOrders.cancel)
  cancel(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.cancel).handler(({ input }) =>
      this.transition('cancel', input.id, user, input.reason),
    );
  }

  /**
   * Move an order along one row of the transition table. The actor is checked before the status,
   * so someone who may not act learns nothing about where the order is. The write is guarded by
   * the status that was read: if another request moved the order in between, nothing is written
   * and the caller gets CONFLICT. Approvals and rejections are audited in the same transaction.
   * Only `status` (and `reason`) change: lines, quantities, prices and the destination store are
   * frozen from the first submission on, and no route edits them. Stock is never touched.
   */
  private async transition(
    name: TransitionName,
    id: string,
    user: User,
    reason?: string,
  ): Promise<PurchaseOrder> {
    const { from, to, verb } = TRANSITIONS[name];

    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: orderInclude,
    });
    if (!order) {
      throw new ORPCError('NOT_FOUND', { message: 'ไม่พบใบสั่งซื้อนี้ กรุณารีเฟรชหน้าจอ' });
    }

    assertStoreScope(user, order.store.code);
    // Submitting is the creator's alone; so is a purchasing officer's cancel. A manager may
    // cancel any order in their store scope.
    if (user.role === 'PURCHASING' && order.createdById !== user.id) {
      throw new ORPCError('FORBIDDEN', {
        message: `เฉพาะผู้สร้างใบสั่งซื้อ ${order.number} เท่านั้นที่${verb}ได้`,
      });
    }

    const illegal = () =>
      new ORPCError('CONFLICT', {
        message: `ไม่สามารถ${verb}ใบสั่งซื้อ ${order.number} ที่มีสถานะ "${STATUS_LABEL[order.status]}" ได้`,
      });
    if (!(from as readonly Status[]).includes(order.status)) throw illegal();

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.purchaseOrder.updateMany({
        where: { id, status: order.status },
        data: reason === undefined ? { status: to } : { status: to, reason },
      });
      if (count === 0) throw illegal();

      if (name === 'approve' || name === 'reject') {
        await tx.auditLog.create({
          data: {
            action: AUDITED[name],
            actorId: user.id,
            storeId: order.store.id,
            sourceType: 'PURCHASE_ORDER',
            sourceId: order.id,
            outcome: 'POSTED',
            detail: reason === undefined ? order.number : `${order.number}: ${reason}`,
          },
        });
      }

      return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    });
    return toPurchaseOrder(updated);
  }
}
