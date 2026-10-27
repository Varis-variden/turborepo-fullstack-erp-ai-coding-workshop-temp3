import { Controller } from '@nestjs/common';
import {
  type ConfirmGoodsReceiptInput,
  contract,
  type GoodsReceipt,
  type ReceivingOrder,
  type User,
} from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { assertStoreScope } from '../auth/store-scope.js';
import { isUniqueConstraintError } from '../database/prisma-errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { allocateDocumentNumber } from '../documents/document-number.js';
import { StockService } from '../inventory/stock.service.js';

/** An order can be received while it is Approved or Partially Received (GR-01). */
const RECEIVABLE_STATUSES = ['APPROVED', 'PARTIALLY_RECEIVED'] as const;

/** Shown only when an idempotency key clashed but the original receipt cannot be read back — the
 * clash was not a replay. The raw constraint error carries database detail, so say it in Thai. */
export const DUPLICATE_RECEIPT_MESSAGE =
  'คำขอรับสินค้านี้ถูกบันทึกไปแล้ว กรุณาตรวจสอบใบรับสินค้าก่อนทำรายการใหม่';

/** The order as the handlers read it: store, supplier and, per line, what earlier receipts brought in. */
const orderInclude = {
  supplier: { select: { name: true } },
  store: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { sku: 'asc' as const },
    include: { receiptLines: { select: { quantity: true } } },
  },
} as const;

type OrderRow = {
  id: string;
  number: string;
  status: ReceivingOrder['status'];
  expectedReceiptDate: Date;
  supplier: { name: string };
  store: { code: string; name: string };
  lines: {
    id: string;
    sku: string;
    productName: string;
    unit: string;
    quantity: number;
    receiptLines: { quantity: number }[];
  }[];
};

const sum = (rows: { quantity: number }[]) => rows.reduce((total, row) => total + row.quantity, 0);

/** The receiving screen's view of an order: per line, ordered, already received and outstanding (GR-01). */
function toReceivingOrder(row: OrderRow): ReceivingOrder {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    supplierName: row.supplier.name,
    storeCode: row.store.code,
    storeName: row.store.name,
    expectedReceiptDate: row.expectedReceiptDate.toISOString().slice(0, 10),
    lines: row.lines.map((line) => {
      const received = sum(line.receiptLines);
      return {
        id: line.id,
        sku: line.sku,
        name: line.productName,
        unit: line.unit,
        ordered: line.quantity,
        received,
        outstanding: line.quantity - received,
      };
    }),
  };
}

/** A confirmed receipt's lines as the GoodsReceipt output carries them, whether just created or
 * read back for a replay: both sources snapshot `productName`, `unit` and `quantity` per SKU. */
type ReceiptLineRow = { sku: string; productName: string; unit: string; quantity: number };

/** The GoodsReceipt response, assembled the one way for both a fresh confirmation and a replay. */
function toGoodsReceipt(receipt: {
  id: string;
  number: string;
  purchaseOrderNumber: string;
  orderStatus: GoodsReceipt['orderStatus'];
  storeCode: string;
  createdAt: Date;
  lines: ReceiptLineRow[];
}): GoodsReceipt {
  return {
    id: receipt.id,
    number: receipt.number,
    purchaseOrderNumber: receipt.purchaseOrderNumber,
    orderStatus: receipt.orderStatus,
    storeCode: receipt.storeCode,
    createdAt: receipt.createdAt.toISOString(),
    lines: receipt.lines.map((line) => ({
      sku: line.sku,
      name: line.productName,
      unit: line.unit,
      quantity: line.quantity,
    })),
  };
}

@Controller()
export class GoodsReceiptsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  @Roles('STAFF')
  @Implement(contract.goodsReceipts.listOrders)
  listOrders(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.listOrders).handler(async ({ input }) => {
      const { page, pageSize } = input;
      // A store employee only ever sees their own store's orders (GR-01, NFR-01). User.storeId
      // holds the store code.
      const where = {
        status: { in: [...RECEIVABLE_STATUSES] },
        ...(user.storeId ? { store: { code: user.storeId } } : {}),
      };
      const [items, total] = await Promise.all([
        this.prisma.purchaseOrder.findMany({
          where,
          include: orderInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.purchaseOrder.count({ where }),
      ]);
      return { items: items.map(toReceivingOrder), page, pageSize, total };
    });
  }

  @Roles('STAFF')
  @Implement(contract.goodsReceipts.confirm)
  confirm(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.confirm).handler(async ({ input }) => {
      // A retry of an action that already posted returns the original receipt, whatever the order
      // has become since (it may be fully received now): the key is looked up before the status
      // and over-receipt checks a fresh confirmation runs, so a replay is never refused by them
      // and never double-counts stock (GR-04).
      const replay = await this.replayReceipt(user, input.idempotencyKey);
      if (replay) return replay;

      try {
        return await this.confirmReceipt(user, input);
      } catch (error) {
        // The key is unique-constrained (NFR-03): two identical requests racing each other both
        // pass the lookup above, then one commits and the other's insert hits the constraint.
        // The loser replays the receipt the winner just wrote rather than failing (GR-04).
        if (isUniqueConstraintError(error, 'idempotencyKey')) {
          const raced = await this.replayReceipt(user, input.idempotencyKey);
          if (raced) return raced;
          throw new ORPCError('CONFLICT', { message: DUPLICATE_RECEIPT_MESSAGE });
        }
        throw error;
      }
    });
  }

  /**
   * The receipt a previous confirmation wrote under this idempotency key, in the GoodsReceipt
   * shape, or `undefined` if the key has not been used (GR-04). Store scope is enforced here too,
   * so a replay can never hand one store's receipt to another (NFR-01).
   */
  private async replayReceipt(
    user: User,
    idempotencyKey: string,
  ): Promise<GoodsReceipt | undefined> {
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { idempotencyKey },
      include: {
        purchaseOrder: { select: { number: true, status: true } },
        store: { select: { code: true } },
        lines: {
          orderBy: { sku: 'asc' },
          select: { sku: true, productName: true, unit: true, quantity: true },
        },
      },
    });
    if (!receipt) return undefined;
    assertStoreScope(user, receipt.store.code);
    return toGoodsReceipt({
      id: receipt.id,
      number: receipt.number,
      purchaseOrderNumber: receipt.purchaseOrder.number,
      orderStatus: receipt.purchaseOrder.status,
      storeCode: receipt.store.code,
      createdAt: receipt.createdAt,
      lines: receipt.lines,
    });
  }

  /**
   * The receipt, its RECEIPT movements, the stock increase, the order status and the audit row
   * post together or roll back together (GR-03, INV-03). The order is read inside the
   * transaction, so the quantities it checks are the authoritative ones.
   */
  private confirmReceipt(user: User, input: ConfirmGoodsReceiptInput): Promise<GoodsReceipt> {
    return this.stock.transact(async (ledger) => {
      const order = await ledger.tx.purchaseOrder.findUnique({
        where: { number: input.purchaseOrderNumber },
        include: orderInclude,
      });
      if (!order) {
        throw new ORPCError('NOT_FOUND', {
          message: `ไม่พบใบสั่งซื้อ ${input.purchaseOrderNumber} กรุณาตรวจสอบเลขที่ใบสั่งซื้อ`,
        });
      }
      // Store scope is enforced here, not in the UI (NFR-01).
      assertStoreScope(user, order.store.code);
      if (!RECEIVABLE_STATUSES.some((status) => status === order.status)) {
        throw new ORPCError('BAD_REQUEST', {
          message: `ใบสั่งซื้อ ${order.number} ไม่อยู่ในสถานะที่รับสินค้าได้ (ต้องอนุมัติแล้วหรือรับสินค้าบางส่วน)`,
        });
      }

      const orderLineBySku = new Map(order.lines.map((line) => [line.sku, line]));
      for (const line of input.lines) {
        const orderLine = orderLineBySku.get(line.sku);
        if (!orderLine) {
          throw new ORPCError('BAD_REQUEST', {
            message: `สินค้า ${line.sku} ไม่อยู่ในใบสั่งซื้อ ${order.number} จึงรับสินค้านี้ไม่ได้`,
          });
        }
        const before = sum(orderLine.receiptLines);
        if (before + line.quantity > orderLine.quantity) {
          throw new ORPCError('BAD_REQUEST', {
            message: `รับสินค้า ${line.sku} เกินจำนวนที่สั่ง (สั่ง ${orderLine.quantity}, รับแล้ว ${before}, คงค้าง ${orderLine.quantity - before})`,
          });
        }
      }

      // Lines delivered at zero are not recorded.
      const received = input.lines.filter((line) => line.quantity > 0);
      const number = await allocateDocumentNumber(ledger.tx, 'GR');
      const receipt = await ledger.tx.goodsReceipt.create({
        data: {
          number,
          idempotencyKey: input.idempotencyKey,
          purchaseOrderId: order.id,
          storeId: order.store.id,
          receivedById: user.id,
          lines: {
            create: received.map((line) => {
              const orderLine = orderLineBySku.get(line.sku)!;
              return {
                purchaseOrderLineId: orderLine.id,
                productId: orderLine.productId,
                sku: orderLine.sku,
                productName: orderLine.productName,
                unit: orderLine.unit,
                quantity: line.quantity,
              };
            }),
          },
        },
        include: { lines: true },
      });

      for (const line of received) {
        await ledger.apply({
          productId: orderLineBySku.get(line.sku)!.productId,
          storeId: order.store.id,
          quantityChange: line.quantity,
          type: 'RECEIPT',
          sourceType: 'GR',
          sourceId: receipt.id,
          actorId: user.id,
        });
      }

      // Completed once every line is fully received, else Partially Received (GR-03).
      const receivedNow = new Map(received.map((line) => [line.sku, line.quantity]));
      const fullyReceived = order.lines.every(
        (line) => sum(line.receiptLines) + (receivedNow.get(line.sku) ?? 0) >= line.quantity,
      );
      const orderStatus = fullyReceived ? 'COMPLETED' : 'PARTIALLY_RECEIVED';
      await ledger.tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: orderStatus },
      });

      await ledger.tx.auditLog.create({
        data: {
          action: 'GOODS_RECEIPT',
          actorId: user.id,
          storeId: order.store.id,
          sourceType: 'GR',
          sourceId: receipt.id,
          outcome: 'POSTED',
          detail: `${receipt.number} against ${order.number}`,
        },
      });

      return toGoodsReceipt({
        id: receipt.id,
        number: receipt.number,
        purchaseOrderNumber: order.number,
        orderStatus,
        storeCode: order.store.code,
        createdAt: receipt.createdAt,
        lines: receipt.lines,
      });
    });
  }
}
