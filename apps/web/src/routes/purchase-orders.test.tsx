import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { PurchaseOrdersPage } from './purchase-orders';

const buyer = {
  id: '1',
  email: 'buyer01@erp.local',
  name: 'Buyer 01',
  role: 'PURCHASING',
  storeId: null,
};
const staff = { id: '2', email: 'staff_b01@erp.local', name: 'Staff', role: 'STAFF', storeId: 'B01' };

const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const iso = '2026-01-01T00:00:00.000Z';
const suppliers = page([
  {
    id: 'sup1',
    code: 'SUP01',
    name: 'SupplyOne Co Ltd',
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    createdAt: iso,
  },
]);
const stores = page([
  { id: 's1', code: 'B01', name: 'Central Store', createdAt: iso },
  { id: 's2', code: 'B02', name: 'Riverside Store', createdAt: iso },
]);
const product = (sku: string, name: string) => ({
  id: sku.toLowerCase(),
  sku,
  name,
  category: 'Beverages',
  unit: 'pack',
  sellingPrice: '60.00',
  active: true,
  reorderThresholds: [],
  createdAt: iso,
});
const products = page([
  product('SKU001', 'Drinking water pack of 6'),
  product('SKU002', 'Tissue paper'),
]);

const draft = {
  id: 'po1',
  number: 'PO-001',
  status: 'DRAFT',
  supplierCode: 'SUP01',
  supplierName: 'SupplyOne Co Ltd',
  storeCode: 'B01',
  storeName: 'Central Store',
  expectedReceiptDate: '2026-02-01',
  createdAt: iso,
  lines: [
    {
      id: 'l1',
      sku: 'SKU001',
      name: 'Drinking water pack of 6',
      unit: 'pack',
      quantity: 20,
      unitPrice: '45.00',
    },
  ],
};

function apiError(status: number, code: string, message: string, data?: unknown) {
  return Response.json({ defined: false, code, status, message, data }, { status });
}

// Disable retries so a failing request surfaces its error state immediately.
function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  return client;
}

function renderPage() {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <PurchaseOrdersPage />
    </QueryClientProvider>,
  );
}

const lookups = {
  'GET /suppliers': suppliers,
  'GET /stores': stores,
  'GET /products': products,
};

async function fillFirstLine(sku: string, quantity: string, price: string) {
  fireEvent.change(await screen.findByLabelText('สินค้า (SKU) รายการที่ 1'), {
    target: { value: sku },
  });
  fireEvent.change(screen.getByLabelText('จำนวนที่สั่ง รายการที่ 1'), {
    target: { value: quantity },
  });
  fireEvent.change(screen.getByLabelText('ราคาซื้อต่อหน่วย (บาท) รายการที่ 1'), {
    target: { value: price },
  });
}

async function fillHeader() {
  await screen.findByRole('option', { name: /SUP01/ });
  await screen.findByRole('option', { name: /B01/ });
  fireEvent.change(screen.getByLabelText('ผู้จัดจำหน่าย'), { target: { value: 'SUP01' } });
  fireEvent.change(screen.getByLabelText('สาขาปลายทาง'), { target: { value: 'B01' } });
  fireEvent.change(screen.getByLabelText('วันที่คาดว่าจะได้รับสินค้า'), {
    target: { value: '2026-02-01' },
  });
}

describe('PurchaseOrdersPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists orders with number, status, supplier, store, date and the snapshotted lines', async () => {
    mockApi({
      'GET /auth/me': { user: buyer },
      'GET /purchase-orders': page([draft]),
      ...lookups,
    });

    renderPage();

    const order = await screen.findByRole('region', { name: 'PO-001' });
    expect(order).toHaveTextContent('ฉบับร่าง');
    expect(order).toHaveTextContent('SupplyOne Co Ltd');
    expect(order).toHaveTextContent('Central Store');
    expect(order).toHaveTextContent('2026-02-01');
    const line = within(order).getByRole('row', { name: /SKU001/ });
    expect(line).toHaveTextContent('Drinking water pack of 6');
    expect(line).toHaveTextContent('pack');
    expect(line).toHaveTextContent('20');
    expect(line).toHaveTextContent('45.00');
  });

  it('shows a clear empty state when there are no orders', async () => {
    mockApi({ 'GET /auth/me': { user: buyer }, 'GET /purchase-orders': page([]), ...lookups });

    renderPage();

    expect(await screen.findByText('ยังไม่มีใบสั่งซื้อ')).toBeInTheDocument();
  });

  it('creates a draft from the form and shows it with its number', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: buyer },
      'GET /purchase-orders': page([]),
      'POST /purchase-orders': draft,
      ...lookups,
    });

    renderPage();
    await fillHeader();
    await fillFirstLine('SKU001', '20', '45');
    fireEvent.click(screen.getByRole('button', { name: 'สร้างใบสั่งซื้อฉบับร่าง' }));

    const request = await waitFor(() => {
      const found = fetch.mock.calls.find(([r]) => r.method === 'POST');
      if (!found) throw new Error('not posted yet');
      return found[0];
    });
    expect(await request.clone().json()).toEqual({
      supplierCode: 'SUP01',
      storeCode: 'B01',
      expectedReceiptDate: '2026-02-01',
      lines: [{ sku: 'SKU001', quantity: 20, unitPrice: '45' }],
    });
  });

  it('sends several lines when lines are added, and lets one be removed', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: buyer },
      'GET /purchase-orders': page([]),
      'POST /purchase-orders': draft,
      ...lookups,
    });

    renderPage();
    await fillHeader();
    await fillFirstLine('SKU001', '20', '45');
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายการสินค้า' }));
    fireEvent.change(screen.getByLabelText('สินค้า (SKU) รายการที่ 2'), {
      target: { value: 'SKU002' },
    });
    fireEvent.change(screen.getByLabelText('จำนวนที่สั่ง รายการที่ 2'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('ราคาซื้อต่อหน่วย (บาท) รายการที่ 2'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรายการสินค้า' }));
    fireEvent.click(screen.getByRole('button', { name: 'ลบรายการที่ 3' }));
    expect(screen.queryByLabelText('สินค้า (SKU) รายการที่ 3')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'สร้างใบสั่งซื้อฉบับร่าง' }));

    const request = await waitFor(() => {
      const found = fetch.mock.calls.find(([r]) => r.method === 'POST');
      if (!found) throw new Error('not posted yet');
      return found[0];
    });
    expect(((await request.clone().json()) as { lines: unknown[] }).lines).toEqual([
      { sku: 'SKU001', quantity: 20, unitPrice: '45' },
      { sku: 'SKU002', quantity: 3, unitPrice: '0' },
    ]);
  });

  it('shows the rejection, such as a duplicate SKU, as an alert', async () => {
    mockApi({
      'GET /auth/me': { user: buyer },
      'GET /purchase-orders': page([]),
      'POST /purchase-orders': apiError(400, 'BAD_REQUEST', 'Input validation failed', {
        issues: [{ message: 'รหัสสินค้า (SKU) SKU001 ซ้ำในใบสั่งซื้อเดียวกัน' }],
      }),
      ...lookups,
    });

    renderPage();
    await fillHeader();
    await fillFirstLine('SKU001', '20', '45');
    fireEvent.click(screen.getByRole('button', { name: 'สร้างใบสั่งซื้อฉบับร่าง' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'รหัสสินค้า (SKU) SKU001 ซ้ำในใบสั่งซื้อเดียวกัน',
    );
  });

  it('hides the form and the list from a store employee', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, ...lookups });

    renderPage();

    expect(await screen.findByText('บัญชีนี้ไม่มีสิทธิ์ดูใบสั่งซื้อ')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'สร้างใบสั่งซื้อฉบับร่าง' }),
    ).not.toBeInTheDocument();
  });
});
