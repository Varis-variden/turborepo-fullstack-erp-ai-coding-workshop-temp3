import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { GoodsReceiptsPage } from './goods-receipts';

const staff = {
  id: 'u-b01',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STAFF',
  storeId: 'B01',
};

const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });

const order = (overrides: Record<string, unknown> = {}) => ({
  id: 'po1',
  number: 'PO-DEMO-001',
  status: 'APPROVED',
  supplierName: 'SupplyOne Co Ltd',
  storeCode: 'B01',
  storeName: 'Central Store',
  expectedReceiptDate: '2026-02-01',
  lines: [
    {
      id: 'pol1',
      sku: 'SKU001',
      name: 'Drinking water pack of 6',
      unit: 'pack',
      ordered: 20,
      received: 0,
      outstanding: 20,
    },
  ],
  ...overrides,
});

const receipt = {
  id: 'gr1',
  number: 'GR-001',
  purchaseOrderNumber: 'PO-DEMO-001',
  orderStatus: 'PARTIALLY_RECEIVED',
  storeCode: 'B01',
  createdAt: '2026-02-02T03:04:05.000Z',
  lines: [{ sku: 'SKU001', name: 'Drinking water pack of 6', unit: 'pack', quantity: 8 }],
};

function apiError(status: number, code: string, message: string) {
  return Response.json({ defined: false, code, status, message }, { status });
}

function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  return client;
}

function renderPage() {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <GoodsReceiptsPage />
    </QueryClientProvider>,
  );
}

/** The bodies of the POSTs made so far. */
async function postedBodies(fetch: ReturnType<typeof mockApi>) {
  const posts = fetch.mock.calls.map(([request]) => request).filter((r) => r.method === 'POST');
  return Promise.all(posts.map((request) => request.clone().json()));
}

describe('GoodsReceiptsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GR-01: shows ordered, previously received and outstanding quantities per line', async () => {
    mockApi({
      'GET /auth/me': { user: staff },
      'GET /goods-receipts/orders': pageOf([
        order({
          status: 'PARTIALLY_RECEIVED',
          lines: [
            {
              id: 'pol1',
              sku: 'SKU001',
              name: 'Drinking water pack of 6',
              unit: 'pack',
              ordered: 20,
              received: 8,
              outstanding: 12,
            },
          ],
        }),
      ]),
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: 'รับสินค้า', level: 1 })).toBeVisible();
    const section = await screen.findByRole('region', { name: 'PO-DEMO-001' });
    expect(section).toHaveTextContent('รับสินค้าบางส่วน');
    const row = within(section).getByRole('row', { name: /SKU001/ });
    expect(within(row).getByRole('cell', { name: '20' })).toBeVisible();
    expect(within(row).getByRole('cell', { name: '8' })).toBeVisible();
    expect(within(row).getByRole('cell', { name: '12' })).toBeVisible();
    expect(within(row).getByRole('cell', { name: 'pack' })).toBeVisible();
  });

  it('says so when no order is waiting to be received', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /goods-receipts/orders': pageOf([]) });

    renderPage();

    expect(await screen.findByText('ไม่มีใบสั่งซื้อที่รอรับสินค้า')).toBeVisible();
  });

  it('confirms a receipt with a client-generated idempotency key and shows the GR- number', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: staff },
      'GET /goods-receipts/orders': pageOf([order()]),
      'POST /goods-receipts': receipt,
    });

    renderPage();
    const quantity = await screen.findByLabelText('จำนวนที่รับครั้งนี้ SKU001');
    fireEvent.change(quantity, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการรับสินค้า' }));

    expect(await screen.findByRole('status')).toHaveTextContent('GR-001');
    const [body] = await postedBodies(fetch);
    expect(body).toEqual({
      purchaseOrderNumber: 'PO-DEMO-001',
      idempotencyKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      ),
      lines: [{ sku: 'SKU001', quantity: 8 }],
    });
  });

  it('uses a fresh idempotency key for a deliberately new receipt, not for a retry', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: staff },
      'GET /goods-receipts/orders': pageOf([order()]),
      'POST /goods-receipts': apiError(500, 'INTERNAL_SERVER_ERROR', 'เกิดข้อผิดพลาดภายในระบบ'),
    });

    renderPage();
    const quantity = await screen.findByLabelText('จำนวนที่รับครั้งนี้ SKU001');
    fireEvent.change(quantity, { target: { value: '8' } });
    const confirm = screen.getByRole('button', { name: 'ยืนยันการรับสินค้า' });
    fireEvent.click(confirm);
    await screen.findByRole('alert');
    // Retrying after a failure repeats the same action, so it carries the same key.
    fireEvent.click(confirm);
    await waitFor(async () => expect(await postedBodies(fetch)).toHaveLength(2));

    const [first, second] = await postedBodies(fetch);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('shows the rejection when the receipt is refused', async () => {
    mockApi({
      'GET /auth/me': { user: staff },
      'GET /goods-receipts/orders': pageOf([order()]),
      'POST /goods-receipts': apiError(400, 'BAD_REQUEST', 'รับสินค้า SKU001 เกินจำนวนที่สั่ง'),
    });

    renderPage();
    const quantity = await screen.findByLabelText('จำนวนที่รับครั้งนี้ SKU001');
    fireEvent.change(quantity, { target: { value: '21' } });
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันการรับสินค้า' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('เกินจำนวนที่สั่ง');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the error when the orders cannot be loaded', async () => {
    mockApi({
      'GET /auth/me': { user: staff },
      'GET /goods-receipts/orders': apiError(
        500,
        'INTERNAL_SERVER_ERROR',
        'เกิดข้อผิดพลาดภายในระบบ',
      ),
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('เกิดข้อผิดพลาดภายในระบบ');
  });
});
