import { oc } from '@orpc/contract';
import * as z from 'zod';
import { paginated, PaginationInputSchema } from './pagination.js';

/**
 * One line of a stock search: the current on-hand quantity of a product in a store, with the
 * unit it is counted in, the store's reorder threshold (null if none is set), and a derived
 * low-stock flag (quantity at or below the threshold). The source of truth is the stock-movement
 * ledger; this is the derived balance, read fast (INV-01).
 */
export const StockItemSchema = z.object({
  productId: z.string(),
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  storeCode: z.string(),
  quantity: z.number().int(),
  reorderThreshold: z.number().int().nullable(),
  lowStock: z.boolean(),
});
export type StockItem = z.infer<typeof StockItemSchema>;

/**
 * Which stock a search returns. `search` matches SKU or product name (case-insensitive);
 * `storeCode` narrows to one store. Both are optional: an empty search is every product in every
 * store the caller may see. The API still enforces store scope, so a store user never sees
 * another store regardless of this filter (NFR-01).
 */
export const SearchStockInputSchema = PaginationInputSchema.extend({
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
  storeCode: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .optional()
    .transform((value) => (value ? value.toUpperCase() : undefined)),
});
export type SearchStockInput = z.infer<typeof SearchStockInputSchema>;

export const StockItemPageSchema = paginated(StockItemSchema);
export type StockItemPage = z.infer<typeof StockItemPageSchema>;

export const inventoryContract = {
  search: oc
    .route({
      method: 'GET',
      path: '/inventory/stock',
      summary: 'Search stock by SKU, product name, and store with current quantity and low-stock',
      tags: ['Inventory'],
    })
    .input(SearchStockInputSchema)
    .output(StockItemPageSchema),
};
