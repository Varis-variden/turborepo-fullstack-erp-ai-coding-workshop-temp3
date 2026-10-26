import type { User } from '@erp/contracts';
import { ORPCError } from '@orpc/nest';

/**
 * Server-side store-scope guard for store-bound handlers.
 *
 * A user with a non-null `storeId` may only act for that store; any other store is rejected
 * with a `FORBIDDEN` oRPC error. A user with `storeId === null` (MANAGER/ADMIN) is unassigned
 * and may act for every store.
 *
 * This is independent of the UI: hiding a button is never the only protection (NFR-01).
 */
export function assertStoreScope(user: Pick<User, 'storeId'>, storeId: string): void {
  if (user.storeId !== null && user.storeId !== storeId) {
    throw new ORPCError('FORBIDDEN', {
      message: 'You are not permitted to act for this store.',
    });
  }
}
