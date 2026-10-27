import { expect, test, type APIRequestContext } from '@playwright/test';
import { storageState } from './accounts.js';

// Demo (ticket #13): receive 8 successfully, then resend the identical request — the original
// receipt is returned, B01 stock stays 18, and cumulative received quantity stays 8; a confirmed
// receipt cannot be edited or cancelled; a genuinely new receipt with a fresh key still posts.
//
// Idempotency and finality are API-level guarantees (a retry after a flaky network, a confirmed
// receipt that has no edit or cancel route), so this walks the Demo line through the API the
// browser uses. The order is this test's own — created by a buyer, approved by a manager, received
// by staff_b01 — so it never collides with the seeded PO-DEMO-001 or another test's rows.
type Order = { id: string; number: string; status: string };
type Receipt = { id: string; number: string; orderStatus: string };
type ReceivingLine = { sku: string; received: number; outstanding: number };
type ReceivingOrder = { number: string; lines: ReceivingLine[] };

test.describe('goods-receipt idempotency and finality', () => {
  test('receiving 8 then resending the identical request returns the original receipt and counts once, a confirmed receipt has no edit or cancel route, and a fresh key still posts', async ({
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
    const staff = await playwright.request.newContext({
      baseURL,
      storageState: storageState('staff'),
    });

    // An Approved order of 20 of SKU001 at B01, staff_b01's own store, as this test's own rows.
    const createResponse = await buyer.post('/api/purchase-orders', {
      data: {
        supplierCode: 'SUP01',
        storeCode: 'B01',
        expectedReceiptDate: '2026-04-01',
        lines: [{ sku: 'SKU001', quantity: 20, unitPrice: '45.00' }],
      },
    });
    expect(createResponse.status()).toBe(200);
    const order = (await createResponse.json()) as Order;
    expect((await buyer.post(`/api/purchase-orders/${order.id}/submit`)).status()).toBe(200);
    expect((await manager.post(`/api/purchase-orders/${order.id}/approve`)).status()).toBe(200);

    // The B01 stock of SKU001 before receiving. Other tests also move SKU001 at B01 in parallel,
    // so the assertions below compare against this snapshot, not a pinned number.
    const stockOfSku001 = async () => {
      const response = await staff.get('/api/inventory/stock', {
        params: { search: 'SKU001', storeCode: 'B01' },
      });
      const page = (await response.json()) as { items: { sku: string; quantity: number }[] };
      return page.items.find((item) => item.sku === 'SKU001')!.quantity;
    };
    const stockBefore = await stockOfSku001();

    const lineOf = async (as: APIRequestContext): Promise<ReceivingLine> => {
      const response = await as.get('/api/goods-receipts/orders', {
        params: { page: 1, pageSize: 100 },
      });
      const page = (await response.json()) as { items: ReceivingOrder[] };
      return page.items.find((item) => item.number === order.number)!.lines[0]!;
    };

    // Ordered 20, nothing received yet.
    expect(await lineOf(staff)).toMatchObject({ received: 0, outstanding: 20 });

    // Receive 8 successfully. This is the request a browser sends; `idempotencyKey` is the one key
    // for this action, so a retry of it carries the same key.
    const idempotencyKey = crypto.randomUUID();
    const confirm = () =>
      staff.post('/api/goods-receipts', {
        data: {
          purchaseOrderNumber: order.number,
          idempotencyKey,
          lines: [{ sku: 'SKU001', quantity: 8 }],
        },
      });
    const firstResponse = await confirm();
    expect(firstResponse.status()).toBe(200);
    const receipt = (await firstResponse.json()) as Receipt;
    expect(receipt.number).toMatch(/^GR-\d{3,}$/);
    expect(receipt.orderStatus).toBe('PARTIALLY_RECEIVED');
    expect(await stockOfSku001()).toBe(stockBefore + 8);
    expect(await lineOf(staff)).toMatchObject({ received: 8, outstanding: 12 });

    // Resend the identical request — the retry a flaky network makes. The original receipt comes
    // back, stock is unchanged, and cumulative received stays 8: the resend counted nothing.
    const replayResponse = await confirm();
    expect(replayResponse.status()).toBe(200);
    expect(await replayResponse.json()).toEqual(receipt);
    expect(await stockOfSku001()).toBe(stockBefore + 8);
    expect(await lineOf(staff)).toMatchObject({ received: 8, outstanding: 12 });

    // A confirmed receipt cannot be edited or cancelled: no such route exists on the receiving
    // API, so an attempt to reach one is not found, never a mutation.
    for (const attempt of [
      staff.post(`/api/goods-receipts/${receipt.id}/cancel`),
      staff.patch(`/api/goods-receipts/${receipt.id}`, { data: { lines: [] } }),
      staff.delete(`/api/goods-receipts/${receipt.id}`),
    ]) {
      expect((await attempt).status()).toBe(404);
    }

    // A genuinely new receipt with a fresh key still posts: it is a different action.
    const secondResponse = await staff.post('/api/goods-receipts', {
      data: {
        purchaseOrderNumber: order.number,
        idempotencyKey: crypto.randomUUID(),
        lines: [{ sku: 'SKU001', quantity: 4 }],
      },
    });
    expect(secondResponse.status()).toBe(200);
    const second = (await secondResponse.json()) as Receipt;
    expect(second.id).not.toBe(receipt.id);
    expect(await stockOfSku001()).toBe(stockBefore + 12);
    expect(await lineOf(staff)).toMatchObject({ received: 12, outstanding: 8 });

    await buyer.dispose();
    await manager.dispose();
    await staff.dispose();
  });
});
