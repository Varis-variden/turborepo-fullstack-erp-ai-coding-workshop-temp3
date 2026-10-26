import * as z from 'zod';

/**
 * Shared list pagination. Every list in the app is newest-first and paginated (TOR Section 6),
 * so these primitives are cross-cutting: the stores list is the first to use them and every
 * later list reuses the same input and response envelope.
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
