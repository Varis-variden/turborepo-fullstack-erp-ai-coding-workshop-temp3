import { oc } from '@orpc/contract';
import * as z from 'zod';
import { paginated, PaginationInputSchema } from './pagination.js';

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
