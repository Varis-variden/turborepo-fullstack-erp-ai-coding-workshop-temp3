import { expect, test, type APIRequestContext } from '@playwright/test';
import { storageState } from './accounts.js';

// Demo (ticket #10): a creator submits a Draft to Pending Approval; a manager approves or
// rejects (reason required on reject); a Draft or Pending Approval order is cancelled by creator
// or manager (reason required); approved lines, quantities, prices, and destination store are
// frozen; a rejected order is terminal and resubmission requires a new order; creating or
// approving an order changes no stock; every transition not in the table is rejected at the API.
//
// The ticket builds the state machine in the API and has no screen for it yet, so this walks the
// Demo line through the API as the two signed-in people, a purchasing officer and a manager.

type Order = { id: string; number: string; status: string; reason: string | null };

test.describe('purchase-order approval', () => {
  test('a creator submits a draft; a manager approves or rejects with a reason; drafts and pending orders can be cancelled with a reason; approved orders are frozen; a rejected order is terminal; no stock moves; every other transition is rejected', async ({
    playwright,
  }) => {
    const baseURL = test.info().project.use.baseURL;
    const buyer = await playwright.request.newContext({
      baseURL,
      storageState: storageState('buyer'),
    });
    const manager = await playwright.request.newContext({
      baseURL,
      storageState: storageState('manager'),
    });

    // Each order is this test's own, with its own quantity as the marker.
    const quantity = 1000 + (Date.now() % 9000);
    async function draft(): Promise<Order> {
      const response = await buyer.post('/api/purchase-orders', {
        data: {
          supplierCode: 'SUP01',
          storeCode: 'B02',
          expectedReceiptDate: '2026-03-01',
          lines: [{ sku: 'SKU003', quantity, unitPrice: '99.50' }],
        },
      });
      expect(response.status()).toBe(200);
      return (await response.json()) as Order;
    }
    async function act(
      as: APIRequestContext,
      order: Order,
      action: 'submit' | 'approve' | 'reject' | 'cancel',
      data: object = {},
    ) {
      return as.post(`/api/purchase-orders/${order.id}/${action}`, { data });
    }
    async function stockOfSku003AtB02() {
      const response = await manager.get('/api/inventory/stock', {
        params: { search: 'SKU003', storeCode: 'B02' },
      });
      const page = (await response.json()) as { items: { sku: string; quantity: number }[] };
      return page.items.find((item) => item.sku === 'SKU003')?.quantity;
    }
    const stockBefore = await stockOfSku003AtB02();
    expect(stockBefore).toBeDefined();

    // A creator submits a Draft to Pending Approval; a manager cannot submit it for them.
    const first = await draft();
    expect(first.status).toBe('DRAFT');
    expect((await act(manager, first, 'submit')).status()).toBe(403);
    const submitted = await act(buyer, first, 'submit');
    expect(submitted.status()).toBe(200);
    expect(((await submitted.json()) as Order).status).toBe('PENDING_APPROVAL');

    // The creator cannot approve their own order; a manager approves it.
    expect((await act(buyer, first, 'approve')).status()).toBe(403);
    const approved = await act(manager, first, 'approve');
    expect(approved.status()).toBe(200);
    expect(await approved.json()).toMatchObject({
      status: 'APPROVED',
      storeCode: 'B02',
      lines: [{ sku: 'SKU003', quantity, unitPrice: '99.50' }],
    });

    // Creating and approving an order changed no stock.
    expect(await stockOfSku003AtB02()).toBe(stockBefore);

    // An approved order is frozen: it cannot be cancelled, rejected, re-approved or resubmitted.
    for (const action of ['submit', 'approve', 'reject', 'cancel'] as const) {
      const response = await act(action === 'submit' ? buyer : manager, first, action, {
        reason: 'too late',
      });
      expect(response.status(), `${action} on an approved order`).toBe(409);
    }

    // Rejecting needs a reason; with one, the order is rejected and that is final.
    const second = await draft();
    expect((await act(manager, second, 'reject', { reason: 'no' })).status()).toBe(409);
    expect((await act(buyer, second, 'submit')).status()).toBe(200);
    expect((await act(manager, second, 'reject', { reason: '   ' })).status()).toBe(400);
    expect((await act(manager, second, 'reject')).status()).toBe(400);
    const rejected = await act(manager, second, 'reject', { reason: 'Price too high' });
    expect(rejected.status()).toBe(200);
    expect(await rejected.json()).toMatchObject({ status: 'REJECTED', reason: 'Price too high' });

    // A rejected order is terminal: resubmission needs a new order.
    for (const action of ['submit', 'approve', 'reject', 'cancel'] as const) {
      const response = await act(action === 'submit' ? buyer : manager, second, action, {
        reason: 'again',
      });
      expect(response.status(), `${action} on a rejected order`).toBe(409);
    }
    const resubmitted = await draft();
    expect(resubmitted.id).not.toBe(second.id);
    expect(resubmitted.status).toBe('DRAFT');

    // A Draft is cancelled by its creator, a Pending Approval order by a manager, each with a reason.
    const third = await draft();
    expect((await act(buyer, third, 'cancel')).status()).toBe(400);
    const cancelledDraft = await act(buyer, third, 'cancel', { reason: 'Ordered by mistake' });
    expect(cancelledDraft.status()).toBe(200);
    expect(await cancelledDraft.json()).toMatchObject({
      status: 'CANCELLED',
      reason: 'Ordered by mistake',
    });

    const fourth = await draft();
    expect((await act(buyer, fourth, 'submit')).status()).toBe(200);
    expect((await act(manager, fourth, 'cancel', { reason: '' })).status()).toBe(400);
    const cancelledPending = await act(manager, fourth, 'cancel', { reason: 'Supplier closed' });
    expect(cancelledPending.status()).toBe(200);
    expect(await cancelledPending.json()).toMatchObject({ status: 'CANCELLED' });

    // A cancelled order cannot be revived, and a draft cannot skip approval.
    expect((await act(buyer, third, 'submit')).status()).toBe(409);
    const fifth = await draft();
    expect((await act(manager, fifth, 'approve')).status()).toBe(409);

    // Approving and rejecting are in the audit log; submitting and cancelling are not.
    const audit = await manager.get('/api/audit', { params: { storeCode: 'B02', pageSize: 100 } });
    const entries = (
      (await audit.json()) as {
        items: { action: string; detail: string | null; outcome: string; actorName: string }[];
      }
    ).items;
    expect(entries).toContainEqual(
      expect.objectContaining({
        action: 'PURCHASE_ORDER_APPROVED',
        detail: first.number,
        outcome: 'POSTED',
        actorName: 'Manager 01',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        action: 'PURCHASE_ORDER_REJECTED',
        detail: `${second.number}: Price too high`,
      }),
    );
    expect(entries.some((entry) => entry.detail?.includes(third.number))).toBe(false);

    // Still no stock movement after every transition above.
    expect(await stockOfSku003AtB02()).toBe(stockBefore);

    await buyer.dispose();
    await manager.dispose();
  });
});
