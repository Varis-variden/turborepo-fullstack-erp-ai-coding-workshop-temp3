import { oc } from '@orpc/contract';
import * as z from 'zod';
import { MONEY_FORMAT } from './money.js';
import { paginated, PaginationInputSchema } from './pagination.js';

/**
 * One line of a purchase order. `sku`, `name`, `unit` and `unitPrice` are the point-in-time
 * snapshot taken when the order was created: later edits to the product never change them
 * (TOR 4.3). `unitPrice` is the purchase price per unit, a two-decimal string (never a float).
 */
export const PurchaseOrderLineSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  quantity: z.number().int(),
  unitPrice: z.string(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

/**
 * The lifecycle of a purchase order (PO-02..PO-04). The API enforces the transition table:
 *
 *   DRAFT              -> PENDING_APPROVAL | CANCELLED
 *   PENDING_APPROVAL   -> APPROVED | REJECTED (terminal) | CANCELLED
 *   APPROVED           -> PARTIALLY_RECEIVED | COMPLETED   (by goods receipt, not by a route here)
 *   PARTIALLY_RECEIVED -> PARTIALLY_RECEIVED | COMPLETED   (by goods receipt)
 *
 * REJECTED, CANCELLED and COMPLETED are terminal.
 */
export const PurchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

/**
 * A purchase order refers to one supplier and one destination store (MD-03). `number` is the
 * unique, zero-padded sequential document number (`PO-001`). `expectedReceiptDate` is a calendar
 * date (`YYYY-MM-DD`), not a moment in time. `reason` is what the manager or creator wrote when
 * the order was rejected or cancelled, and null otherwise.
 */
export const PurchaseOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: PurchaseOrderStatusSchema,
  supplierCode: z.string(),
  supplierName: z.string(),
  storeCode: z.string(),
  storeName: z.string(),
  expectedReceiptDate: z.iso.date(),
  createdAt: z.iso.datetime(),
  reason: z.string().nullable(),
  lines: z.array(PurchaseOrderLineSchema),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

const UNIT_PRICE_FORMAT_MESSAGE = 'ราคาซื้อต่อหน่วยต้องเป็นตัวเลขและมีทศนิยมไม่เกิน 2 ตำแหน่ง';

/**
 * Purchase unit price as entered: a non-negative amount with at most two decimals (PO-01). The
 * parsed value is normalised to exactly two decimals. Zero is allowed.
 */
const UnitPriceSchema = z
  .string(UNIT_PRICE_FORMAT_MESSAGE)
  .trim()
  .transform((value, ctx) => {
    if (!MONEY_FORMAT.test(value)) {
      ctx.addIssue({ code: 'custom', message: UNIT_PRICE_FORMAT_MESSAGE });
      return z.NEVER;
    }
    if (value.startsWith('-')) {
      ctx.addIssue({ code: 'custom', message: 'ราคาซื้อต่อหน่วยต้องไม่ติดลบ' });
      return z.NEVER;
    }
    return Number(value).toFixed(2);
  });

/** Ordered quantity: a positive whole number (PO-01), within what the database column holds. */
const OrderedQuantitySchema = z
  .number('จำนวนที่สั่งต้องเป็นตัวเลข')
  .int('จำนวนที่สั่งต้องเป็นจำนวนเต็มที่มากกว่า 0')
  .min(1, 'จำนวนที่สั่งต้องเป็นจำนวนเต็มที่มากกว่า 0')
  .max(2_147_483_647, 'จำนวนที่สั่งมากเกินไป');

const CreatePurchaseOrderLineInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุรหัสสินค้า (SKU)')
    .max(30, 'รหัสสินค้า (SKU) ต้องไม่เกิน 30 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  quantity: OrderedQuantitySchema,
  unitPrice: UnitPriceSchema,
});
export type CreatePurchaseOrderLineInput = z.infer<typeof CreatePurchaseOrderLineInputSchema>;

/**
 * Input for creating a draft purchase order (PO-01): a supplier, a destination store, an
 * expected receipt date and at least one line. Codes and SKUs are trimmed and uppercased so
 * lookups and the duplicate-SKU check do not depend on casing. Messages are the actionable Thai
 * copy the UI and API surface (NFR-04).
 */
export const CreatePurchaseOrderInputSchema = z.object({
  supplierCode: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุผู้จัดจำหน่าย')
    .max(20, 'รหัสผู้จัดจำหน่ายต้องไม่เกิน 20 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  storeCode: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุสาขาปลายทาง')
    .max(20, 'รหัสสาขาต้องไม่เกิน 20 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  expectedReceiptDate: z.iso.date('กรุณาระบุวันที่คาดว่าจะได้รับสินค้าให้ถูกต้อง'),
  lines: z
    .array(CreatePurchaseOrderLineInputSchema)
    .min(1, 'ใบสั่งซื้อต้องมีสินค้าอย่างน้อย 1 รายการ')
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      for (const [index, line] of lines.entries()) {
        if (seen.has(line.sku)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'sku'],
            message: `รหัสสินค้า (SKU) ${line.sku} ซ้ำในใบสั่งซื้อเดียวกัน`,
          });
        }
        seen.add(line.sku);
      }
    }),
});
export type CreatePurchaseOrderInput = z.infer<typeof CreatePurchaseOrderInputSchema>;

export const ListPurchaseOrdersInputSchema = PaginationInputSchema;
export type ListPurchaseOrdersInput = z.infer<typeof ListPurchaseOrdersInputSchema>;

export const SubmitPurchaseOrderInputSchema = z.object({ id: z.string().min(1) });
export type SubmitPurchaseOrderInput = z.infer<typeof SubmitPurchaseOrderInputSchema>;

export const ApprovePurchaseOrderInputSchema = z.object({ id: z.string().min(1) });
export type ApprovePurchaseOrderInput = z.infer<typeof ApprovePurchaseOrderInputSchema>;

/** A trimmed, mandatory reason of at most 200 characters, with the given "please give a reason" copy. */
const reasonSchema = (requiredMessage: string) =>
  z
    .string(requiredMessage)
    .trim()
    .min(1, requiredMessage)
    .max(200, 'เหตุผลต้องไม่เกิน 200 ตัวอักษร');

/** Rejecting an order needs a reason (PO-03). */
export const RejectPurchaseOrderInputSchema = z.object({
  id: z.string().min(1),
  reason: reasonSchema('กรุณาระบุเหตุผลในการปฏิเสธใบสั่งซื้อ'),
});
export type RejectPurchaseOrderInput = z.infer<typeof RejectPurchaseOrderInputSchema>;

/** Cancelling an order needs a reason (PO-04). */
export const CancelPurchaseOrderInputSchema = z.object({
  id: z.string().min(1),
  reason: reasonSchema('กรุณาระบุเหตุผลในการยกเลิกใบสั่งซื้อ'),
});
export type CancelPurchaseOrderInput = z.infer<typeof CancelPurchaseOrderInputSchema>;

export const PurchaseOrderPageSchema = paginated(PurchaseOrderSchema);
export type PurchaseOrderPage = z.infer<typeof PurchaseOrderPageSchema>;

export const purchaseOrdersContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/purchase-orders',
      summary: 'List purchase orders, newest first',
      tags: ['Purchase orders'],
    })
    .input(ListPurchaseOrdersInputSchema)
    .output(PurchaseOrderPageSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/purchase-orders',
      summary: 'Create a draft purchase order with the next PO- number',
      tags: ['Purchase orders'],
    })
    .input(CreatePurchaseOrderInputSchema)
    .output(PurchaseOrderSchema),
  submit: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/submit',
      summary: 'Submit a draft purchase order for approval (its creator only)',
      tags: ['Purchase orders'],
    })
    .input(SubmitPurchaseOrderInputSchema)
    .output(PurchaseOrderSchema),
  approve: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/approve',
      summary: 'Approve a purchase order that is pending approval (manager)',
      tags: ['Purchase orders'],
    })
    .input(ApprovePurchaseOrderInputSchema)
    .output(PurchaseOrderSchema),
  reject: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/reject',
      summary: 'Reject a purchase order that is pending approval, with a reason (manager)',
      tags: ['Purchase orders'],
    })
    .input(RejectPurchaseOrderInputSchema)
    .output(PurchaseOrderSchema),
  cancel: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/cancel',
      summary: 'Cancel a draft or pending purchase order, with a reason (creator or manager)',
      tags: ['Purchase orders'],
    })
    .input(CancelPurchaseOrderInputSchema)
    .output(PurchaseOrderSchema),
};
