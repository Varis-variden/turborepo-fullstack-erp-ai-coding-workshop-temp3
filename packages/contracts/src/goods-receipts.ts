import { oc } from '@orpc/contract';
import * as z from 'zod';
import { paginated, PaginationInputSchema } from './pagination.js';
import { PurchaseOrderStatusSchema } from './purchase-orders.js';

/**
 * One line of the receiving screen (GR-01): what was ordered, what earlier deliveries already
 * brought in, and what is still outstanding. `sku`, `name` and `unit` are the purchase order
 * line's snapshot.
 */
export const ReceivingLineSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  ordered: z.number().int(),
  received: z.number().int(),
  outstanding: z.number().int(),
});
export type ReceivingLine = z.infer<typeof ReceivingLineSchema>;

/** An approved or partially received order as the receiving screen shows it. */
export const ReceivingOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: PurchaseOrderStatusSchema,
  supplierName: z.string(),
  storeCode: z.string(),
  storeName: z.string(),
  expectedReceiptDate: z.iso.date(),
  lines: z.array(ReceivingLineSchema),
});
export type ReceivingOrder = z.infer<typeof ReceivingOrderSchema>;

export const ListReceivableOrdersInputSchema = PaginationInputSchema;
export type ListReceivableOrdersInput = z.infer<typeof ListReceivableOrdersInputSchema>;

export const ReceivingOrderPageSchema = paginated(ReceivingOrderSchema);
export type ReceivingOrderPage = z.infer<typeof ReceivingOrderPageSchema>;

/** Received quantity: a non-negative whole number (GR-02), within what the database column holds. */
const ReceivedQuantitySchema = z
  .number('จำนวนที่รับต้องเป็นตัวเลข')
  .int('จำนวนที่รับต้องเป็นจำนวนเต็มที่ไม่ติดลบ')
  .min(0, 'จำนวนที่รับต้องเป็นจำนวนเต็มที่ไม่ติดลบ')
  .max(2_147_483_647, 'จำนวนที่รับมากเกินไป');

/**
 * Input for confirming a goods receipt (GR-02, GR-04). `idempotencyKey` is a client-generated
 * UUID, one per user action: it is unique-constrained in the database, so the same action can
 * never post twice (NFR-03). Each line names a SKU of the order and the quantity delivered now;
 * at least one line must be above zero. Messages are the actionable Thai copy the UI and API
 * surface (NFR-04).
 */
export const ConfirmGoodsReceiptInputSchema = z.object({
  purchaseOrderNumber: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุเลขที่ใบสั่งซื้อ')
    .max(40, 'เลขที่ใบสั่งซื้อต้องไม่เกิน 40 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  idempotencyKey: z.uuid('รหัสป้องกันการบันทึกซ้ำไม่ถูกต้อง'),
  lines: z
    .array(
      z.object({
        sku: z
          .string()
          .trim()
          .min(1, 'กรุณาระบุรหัสสินค้า (SKU)')
          .max(30, 'รหัสสินค้า (SKU) ต้องไม่เกิน 30 ตัวอักษร')
          .transform((value) => value.toUpperCase()),
        quantity: ReceivedQuantitySchema,
      }),
    )
    .min(1, 'ต้องระบุสินค้าที่รับอย่างน้อย 1 รายการ')
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      for (const [index, line] of lines.entries()) {
        if (seen.has(line.sku)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'sku'],
            message: `รหัสสินค้า (SKU) ${line.sku} ซ้ำในใบรับสินค้าเดียวกัน`,
          });
        }
        seen.add(line.sku);
      }
      if (!lines.some((line) => line.quantity > 0)) {
        ctx.addIssue({
          code: 'custom',
          message: 'ต้องรับสินค้าอย่างน้อย 1 รายการที่มีจำนวนมากกว่า 0',
        });
      }
    }),
});
export type ConfirmGoodsReceiptInput = z.infer<typeof ConfirmGoodsReceiptInputSchema>;

/** A confirmed goods receipt: its `GR-` number, the order it fulfilled and the status that left. */
export const GoodsReceiptSchema = z.object({
  id: z.string(),
  number: z.string(),
  purchaseOrderNumber: z.string(),
  orderStatus: PurchaseOrderStatusSchema,
  storeCode: z.string(),
  createdAt: z.iso.datetime(),
  lines: z.array(
    z.object({
      sku: z.string(),
      name: z.string(),
      unit: z.string(),
      quantity: z.number().int(),
    }),
  ),
});
export type GoodsReceipt = z.infer<typeof GoodsReceiptSchema>;

export const goodsReceiptsContract = {
  listOrders: oc
    .route({
      method: 'GET',
      path: '/goods-receipts/orders',
      summary: 'List approved and partially received orders for the caller’s store to receive',
      tags: ['Goods receipts'],
    })
    .input(ListReceivableOrdersInputSchema)
    .output(ReceivingOrderPageSchema),
  confirm: oc
    .route({
      method: 'POST',
      path: '/goods-receipts',
      summary: 'Confirm a goods receipt: GR- number, stock increase and movements in one transaction',
      tags: ['Goods receipts'],
    })
    .input(ConfirmGoodsReceiptInputSchema)
    .output(GoodsReceiptSchema),
};
