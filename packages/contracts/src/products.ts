import { oc } from '@orpc/contract';
import * as z from 'zod';
import { MONEY_FORMAT } from './money.js';
import { paginated, PaginationInputSchema } from './pagination.js';

/** A reorder threshold for one store, keyed by the store's business code (e.g. "B01"). */
export const ReorderThresholdSchema = z.object({
  storeCode: z.string(),
  threshold: z.number().int(),
});
export type ReorderThreshold = z.infer<typeof ReorderThresholdSchema>;

/**
 * A product is something the retailer buys and sells. `sku` is the business key used across the
 * app. `sellingPrice` is money, so it travels as a string with exactly two decimals (never a
 * float). An inactive product is kept for historical records but cannot go on a new document.
 */
export const ProductSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  sellingPrice: z.string(),
  active: z.boolean(),
  reorderThresholds: z.array(ReorderThresholdSchema),
  createdAt: z.iso.datetime(),
});
export type Product = z.infer<typeof ProductSchema>;

/**
 * Selling price as entered: a non-negative amount with at most two decimals (MD-02). The parsed
 * value is normalised to exactly two decimals so what is stored and shown is consistent.
 */
const SellingPriceSchema = z
  .string('ราคาขายต้องเป็นตัวเลขและมีทศนิยมไม่เกิน 2 ตำแหน่ง')
  .trim()
  .transform((value, ctx) => {
    if (!MONEY_FORMAT.test(value)) {
      ctx.addIssue({
        code: 'custom',
        message: 'ราคาขายต้องเป็นตัวเลขและมีทศนิยมไม่เกิน 2 ตำแหน่ง',
      });
      return z.NEVER;
    }
    if (value.startsWith('-')) {
      ctx.addIssue({ code: 'custom', message: 'ราคาขายต้องไม่ติดลบ' });
      return z.NEVER;
    }
    return Number(value).toFixed(2);
  });

/** A stock quantity or threshold: a whole number that is not negative (MD-02). */
const ReorderThresholdValueSchema = z
  .number('จุดสั่งซื้อซ้ำต้องเป็นตัวเลข')
  .int('จำนวนต้องเป็นจำนวนเต็ม')
  .min(0, 'จุดสั่งซื้อซ้ำต้องไม่ติดลบ');

const ReorderThresholdsInputSchema = z
  .array(
    z.object({
      storeCode: z
        .string()
        .trim()
        .min(1, 'กรุณาระบุรหัสสาขา')
        .transform((value) => value.toUpperCase()),
      threshold: ReorderThresholdValueSchema,
    }),
  )
  .superRefine((thresholds, ctx) => {
    const codes = thresholds.map((entry) => entry.storeCode);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'แต่ละสาขากำหนดจุดสั่งซื้อซ้ำได้เพียงค่าเดียว',
      });
    }
  });

/**
 * Input for creating a product. SKUs are trimmed and uppercased so uniqueness does not depend on
 * casing or stray whitespace. Messages are the actionable Thai copy the UI and API surface (NFR-04).
 */
export const CreateProductInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุรหัสสินค้า (SKU)')
    .max(30, 'รหัสสินค้า (SKU) ต้องไม่เกิน 30 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  name: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุชื่อสินค้า')
    .max(150, 'ชื่อสินค้าต้องไม่เกิน 150 ตัวอักษร'),
  category: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุหมวดหมู่สินค้า')
    .max(50, 'หมวดหมู่สินค้าต้องไม่เกิน 50 ตัวอักษร'),
  unit: z.string().trim().min(1, 'กรุณาระบุหน่วยนับ').max(20, 'หน่วยนับต้องไม่เกิน 20 ตัวอักษร'),
  sellingPrice: SellingPriceSchema,
  active: z.boolean().default(true),
  reorderThresholds: ReorderThresholdsInputSchema.default([]),
});
export type CreateProductInput = z.infer<typeof CreateProductInputSchema>;

/**
 * Which products a list returns. `ACTIVE` (the default) is what a new document may use; `ALL`
 * includes deactivated products so historical records can still be found (MD-02).
 */
export const ListProductsInputSchema = PaginationInputSchema.extend({
  status: z.enum(['ACTIVE', 'ALL']).default('ACTIVE'),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type ListProductsInput = z.infer<typeof ListProductsInputSchema>;

export const SetProductActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type SetProductActiveInput = z.infer<typeof SetProductActiveInputSchema>;

export const ProductPageSchema = paginated(ProductSchema);
export type ProductPage = z.infer<typeof ProductPageSchema>;

export const productsContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/products',
      summary: 'List products, newest first. Active only unless status=ALL',
      tags: ['Products'],
    })
    .input(ListProductsInputSchema)
    .output(ProductPageSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/products',
      summary: 'Create a product',
      tags: ['Products'],
    })
    .input(CreateProductInputSchema)
    .output(ProductSchema),
  setActive: oc
    .route({
      method: 'POST',
      path: '/products/{id}/active',
      summary: 'Activate or deactivate a product',
      tags: ['Products'],
    })
    .input(SetProductActiveInputSchema)
    .output(ProductSchema),
};
