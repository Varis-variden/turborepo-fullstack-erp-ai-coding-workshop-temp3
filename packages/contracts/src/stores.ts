import { oc } from '@orpc/contract';
import * as z from 'zod';

/** A store is a distinct stock location. `code` is the business key used across the app. */
export const StoreSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type Store = z.infer<typeof StoreSchema>;

/**
 * Input for creating a store. Codes are trimmed and uppercased so uniqueness does not depend on
 * casing or stray whitespace. Messages are the actionable Thai copy the UI and API surface (NFR-04).
 */
export const CreateStoreInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'กรุณาระบุรหัสสาขา')
    .max(20, 'รหัสสาขาต้องไม่เกิน 20 ตัวอักษร')
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อสาขา').max(100, 'ชื่อสาขาต้องไม่เกิน 100 ตัวอักษร'),
});
export type CreateStoreInput = z.infer<typeof CreateStoreInputSchema>;

/**
 * Shared list pagination. The stores list is the first list in the app, so it owns these
 * primitives; every later list reuses them. Lists are always newest-first (TOR Section 6).
 */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export const PaginationInputSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationInput = z.infer<typeof PaginationInputSchema>;

/** Wrap an item schema in the shared paginated-response envelope. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

export const StorePageSchema = paginated(StoreSchema);
export type StorePage = z.infer<typeof StorePageSchema>;

export const storesContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/stores',
      summary: 'List stores, newest first',
      tags: ['Stores'],
    })
    .input(PaginationInputSchema)
    .output(StorePageSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/stores',
      summary: 'Create a store',
      tags: ['Stores'],
    })
    .input(CreateStoreInputSchema)
    .output(StoreSchema),
};
