import { oc } from '@orpc/contract';
import * as z from 'zod';
import { paginated, PaginationInputSchema } from './pagination.js';

/**
 * One line of a sale. `sku`, `name`, `unit` and `unitPrice` are the point-in-time snapshot taken
 * when the sale was created from the product's current selling price: later edits to the product
 * never change them, and the caller can never override the price (SAL-01). `unitPrice` and
 * `lineAmount` are two-decimal strings (never a float); `lineAmount` is quantity × unitPrice.
 */
export const SaleLineSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  quantity: z.number().int(),
  unitPrice: z.string(),
  lineAmount: z.string(),
});
export type SaleLine = z.infer<typeof SaleLineSchema>;

/**
 * A draft sale raised at one store (SAL-01). `number` is the unique, zero-padded sequential
 * document number (`SAL-001`). `total` is the sum of the line amounts, a two-decimal string.
 * Creating a draft sale does not change stock (SAL-02).
 */
export const SaleSchema = z.object({
  id: z.string(),
  number: z.string(),
  storeCode: z.string(),
  storeName: z.string(),
  createdAt: z.iso.datetime(),
  total: z.string(),
  lines: z.array(SaleLineSchema),
});
export type Sale = z.infer<typeof SaleSchema>;

/** Sold quantity: a positive whole number (SAL-01), within what the database column holds. */
const SoldQuantitySchema = z
  .number('จำนวนที่ขายต้องเป็นตัวเลข')
  .int('จำนวนที่ขายต้องเป็นจำนวนเต็มที่มากกว่า 0')
  .min(1, 'จำนวนที่ขายต้องเป็นจำนวนเต็มที่มากกว่า 0')
  .max(2_147_483_647, 'จำนวนที่ขายมากเกินไป');

/**
 * One line of a new sale: a SKU and a quantity, nothing else. There is deliberately no price
 * field — the selling price is the product's current one, snapshotted on the server, and the
 * caller cannot override it (SAL-01). An unknown key such as `unitPrice` is stripped.
 */
const CreateSaleLineInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุรหัสสินค้า (SKU)')
    .max(30, 'รหัสสินค้า (SKU) ต้องไม่เกิน 30 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  quantity: SoldQuantitySchema,
});
export type CreateSaleLineInput = z.infer<typeof CreateSaleLineInputSchema>;

/**
 * Input for creating a draft sale (SAL-01): at least one line, each a SKU and a positive
 * whole-number quantity. The store is the caller's assigned store, not part of the input.
 * SKUs are trimmed and uppercased so the duplicate-SKU check does not depend on casing.
 * Messages are the actionable Thai copy the UI and API surface (NFR-04).
 */
export const CreateSaleInputSchema = z.object({
  lines: z
    .array(CreateSaleLineInputSchema)
    .min(1, 'การขายต้องมีสินค้าอย่างน้อย 1 รายการ')
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      for (const [index, line] of lines.entries()) {
        if (seen.has(line.sku)) {
          ctx.addIssue({
            code: 'custom',
            path: [index, 'sku'],
            message: `รหัสสินค้า (SKU) ${line.sku} ซ้ำในการขายเดียวกัน`,
          });
        }
        seen.add(line.sku);
      }
    }),
});
export type CreateSaleInput = z.infer<typeof CreateSaleInputSchema>;

export const ListSalesInputSchema = PaginationInputSchema;
export type ListSalesInput = z.infer<typeof ListSalesInputSchema>;

export const SalePageSchema = paginated(SaleSchema);
export type SalePage = z.infer<typeof SalePageSchema>;

export const salesContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/sales',
      summary: 'List sales for the caller’s store, newest first',
      tags: ['Sales'],
    })
    .input(ListSalesInputSchema)
    .output(SalePageSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/sales',
      summary: 'Create a draft sale with the next SAL- number at the caller’s store',
      tags: ['Sales'],
    })
    .input(CreateSaleInputSchema)
    .output(SaleSchema),
};
