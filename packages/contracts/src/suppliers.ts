import { oc } from '@orpc/contract';
import * as z from 'zod';
import { paginated, PaginationInputSchema } from './pagination.js';

/**
 * A supplier is an organization a purchase order can be raised against. `code` is the business key
 * used across the app. Contact details are optional so a supplier can be created before they are
 * known, and are null (not absent) in responses when unset.
 */
export const SupplierSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Supplier = z.infer<typeof SupplierSchema>;

/** An optional free-text contact field: trimmed, and an empty value becomes absent (undefined). */
function optionalText(max: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value ? value : undefined));
}

/**
 * Input for creating a supplier. Codes are trimmed and uppercased so uniqueness does not depend on
 * casing or stray whitespace. Messages are the actionable Thai copy the UI and API surface (NFR-04).
 */
export const CreateSupplierInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุรหัสผู้จัดจำหน่าย')
    .max(20, 'รหัสผู้จัดจำหน่ายต้องไม่เกิน 20 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  name: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุชื่อผู้จัดจำหน่าย')
    .max(100, 'ชื่อผู้จัดจำหน่ายต้องไม่เกิน 100 ตัวอักษร'),
  contactName: optionalText(100, 'ชื่อผู้ติดต่อต้องไม่เกิน 100 ตัวอักษร'),
  contactPhone: optionalText(30, 'เบอร์โทรต้องไม่เกิน 30 ตัวอักษร'),
  contactEmail: z
    .union([z.literal(''), z.email('กรุณาระบุอีเมลให้ถูกต้อง')])
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type CreateSupplierInput = z.infer<typeof CreateSupplierInputSchema>;

export const SupplierPageSchema = paginated(SupplierSchema);
export type SupplierPage = z.infer<typeof SupplierPageSchema>;

export const suppliersContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/suppliers',
      summary: 'List suppliers, newest first',
      tags: ['Suppliers'],
    })
    .input(PaginationInputSchema)
    .output(SupplierPageSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/suppliers',
      summary: 'Create a supplier',
      tags: ['Suppliers'],
    })
    .input(CreateSupplierInputSchema)
    .output(SupplierSchema),
};
