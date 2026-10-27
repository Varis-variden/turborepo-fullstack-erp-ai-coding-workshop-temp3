import { oc } from '@orpc/contract';
import * as z from 'zod';
import { paginated, PaginationInputSchema } from './pagination.js';

/**
 * Input for a manager stock adjustment (INV-05): the product and store, a signed whole-unit
 * change (positive to increase, negative to decrease), and a mandatory reason. `sku` and
 * `storeCode` are trimmed and uppercased so lookups do not depend on casing; the reason is
 * trimmed and must not be blank. A zero change is rejected: an adjustment must move stock.
 * Messages are the actionable Thai copy the UI and API surface (NFR-04).
 */
export const AdjustStockInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุรหัสสินค้า (SKU)')
    .max(30, 'รหัสสินค้า (SKU) ต้องไม่เกิน 30 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  storeCode: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุสาขา')
    .max(20, 'รหัสสาขาต้องไม่เกิน 20 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  quantityChange: z
    .number('จำนวนที่ปรับต้องเป็นตัวเลข')
    .int('จำนวนที่ปรับต้องเป็นจำนวนเต็ม')
    .min(-2_147_483_647, 'จำนวนที่ปรับมากเกินไป')
    .max(2_147_483_647, 'จำนวนที่ปรับมากเกินไป')
    .refine((value) => value !== 0, 'จำนวนที่ปรับต้องไม่เท่ากับ 0'),
  reason: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุเหตุผลในการปรับสต็อก')
    .max(200, 'เหตุผลต้องไม่เกิน 200 ตัวอักษร'),
});
export type AdjustStockInput = z.infer<typeof AdjustStockInputSchema>;

/**
 * The result of a posted stock adjustment: the product and store, the signed change actually
 * applied, and the store balance before and after. The source of truth is the stock-movement
 * ledger (INV-02); this echoes what the movement recorded so the UI can show the new balance.
 */
export const StockAdjustmentResultSchema = z.object({
  sku: z.string(),
  storeCode: z.string(),
  quantityChange: z.number().int(),
  balanceBefore: z.number().int(),
  balanceAfter: z.number().int(),
});
export type StockAdjustmentResult = z.infer<typeof StockAdjustmentResultSchema>;

/** Whether an audited action succeeded or was rejected (NFR-03). */
export const AuditOutcomeSchema = z.enum(['POSTED', 'REJECTED']);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

/**
 * One audit-log entry (NFR-03): the action, who did it and when, the source document it refers
 * to, the store it happened in (so reads can be store-scoped), the outcome, and a human-readable
 * detail (e.g. the adjustment reason). Reads are restricted by permission and store scope.
 */
export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  storeCode: z.string(),
  sourceType: z.string(),
  sourceId: z.string().nullable(),
  outcome: AuditOutcomeSchema,
  detail: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/**
 * Which audit entries a read returns. `storeCode` narrows to one store; the API still enforces
 * store scope, so a store-bound reader never sees another store regardless of this filter
 * (NFR-03). Empty means every store the caller may see.
 */
export const ListAuditInputSchema = PaginationInputSchema.extend({
  storeCode: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .optional()
    .transform((value) => (value ? value.toUpperCase() : undefined)),
});
export type ListAuditInput = z.infer<typeof ListAuditInputSchema>;

export const AuditEntryPageSchema = paginated(AuditEntrySchema);
export type AuditEntryPage = z.infer<typeof AuditEntryPageSchema>;

export const auditContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/audit',
      summary: 'List audit-log entries, newest first, restricted by permission and store scope',
      tags: ['Audit'],
    })
    .input(ListAuditInputSchema)
    .output(AuditEntryPageSchema),
};
