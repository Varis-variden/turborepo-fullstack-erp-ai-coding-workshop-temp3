import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { ProductsPage } from './products';

const admin = { id: '1', email: 'admin@erp.local', name: 'Admin', role: 'ADMIN', storeId: null };
const staff = { id: '2', email: 'staff@erp.local', name: 'Staff', role: 'STAFF', storeId: 'B01' };

const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const product = (sku: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id: sku.toLowerCase(),
  sku,
  name,
  category: 'Beverages',
  unit: 'pack',
  sellingPrice: '60.00',
  active: true,
  reorderThresholds: [{ storeCode: 'B01', threshold: 3 }],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
const stores = page([
  { id: 's1', code: 'B01', name: 'Central Store', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 's2', code: 'B02', name: 'Riverside Store', createdAt: '2026-01-01T00:00:00.000Z' },
]);

function apiError(status: number, code: string, message: string, data?: unknown) {
  return Response.json({ defined: false, code, status, message, data }, { status });
}

// Disable retries so a failing request surfaces its error state immediately, without the
// production retry backoff slowing the test. Retry policy itself is covered in query-client.
function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  return client;
}

function renderPage() {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <ProductsPage />
    </QueryClientProvider>,
  );
}

describe('ProductsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists products with price, unit, status and the threshold per store', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': stores,
      'GET /products': page([
        product('SKU001', 'Drinking water pack of 6'),
        product('SKU002', 'Tissue paper', { sellingPrice: '35.00', active: false }),
      ]),
    });

    renderPage();

    const water = await screen.findByRole('row', { name: /SKU001/ });
    expect(water).toHaveTextContent('Drinking water pack of 6');
    expect(water).toHaveTextContent('60.00');
    expect(water).toHaveTextContent('B01: 3');
    expect(water).toHaveTextContent('ใช้งาน');
    expect(screen.getByRole('row', { name: /SKU002/ })).toHaveTextContent('ปิดใช้งาน');
  });

  it('shows a clear empty state when there are no products', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /stores': stores, 'GET /products': page([]) });

    renderPage();

    expect(await screen.findByText('ยังไม่มีสินค้า')).toBeInTheDocument();
  });

  it('shows an error state when the list request fails', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': stores,
      'GET /products': apiError(500, 'INTERNAL_SERVER_ERROR', 'เกิดข้อผิดพลาด'),
    });

    renderPage();

    expect(await screen.findByText(/เกิดข้อผิดพลาด/)).toBeInTheDocument();
  });

  it('asks for active products only, and for all of them once historical products are shown', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': stores,
      'GET /products': page([product('SKU001', 'Drinking water pack of 6')]),
    });
    const productStatuses = () =>
      fetch.mock.calls
        .map(([request]) => new URL((request as Request).url))
        .filter((url) => url.pathname === '/api/products')
        .map((url) => url.searchParams.get('status'));

    renderPage();
    await screen.findByRole('row', { name: /SKU001/ });
    expect(productStatuses()).toEqual(['ACTIVE']);

    fireEvent.click(screen.getByLabelText('แสดงสินค้าที่ปิดใช้งาน'));

    await waitFor(() => expect(productStatuses()).toContain('ALL'));
  });

  it('hides the create form and the deactivate button from a non-admin', async () => {
    mockApi({
      'GET /auth/me': { user: staff },
      'GET /stores': stores,
      'GET /products': page([product('SKU001', 'Drinking water pack of 6')]),
    });

    renderPage();

    await screen.findByRole('row', { name: /SKU001/ });
    expect(screen.queryByLabelText('รหัสสินค้า (SKU)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ปิดใช้งาน/ })).not.toBeInTheDocument();
  });

  it('lets an admin create a product with a threshold for a store', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': stores,
      'GET /products': page([]),
      'POST /products': product('SKU001', 'Drinking water pack of 6'),
    });

    renderPage();

    fireEvent.change(await screen.findByLabelText('รหัสสินค้า (SKU)'), {
      target: { value: 'sku001' },
    });
    fireEvent.change(screen.getByLabelText('ชื่อสินค้า'), {
      target: { value: 'Drinking water pack of 6' },
    });
    fireEvent.change(screen.getByLabelText('หมวดหมู่'), { target: { value: 'Beverages' } });
    fireEvent.change(screen.getByLabelText('หน่วยนับ'), { target: { value: 'pack' } });
    fireEvent.change(screen.getByLabelText('ราคาขาย (บาท)'), { target: { value: '60' } });
    fireEvent.change(await screen.findByLabelText('จุดสั่งซื้อซ้ำ สาขา B01'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มสินค้า' }));

    await waitFor(() => {
      const post = fetch.mock.calls.find(([request]) => (request as Request).method === 'POST');
      expect(post).toBeDefined();
    });
    const post = fetch.mock.calls.find(([request]) => (request as Request).method === 'POST');
    expect(await (post?.[0] as Request).json()).toMatchObject({
      sku: 'sku001',
      name: 'Drinking water pack of 6',
      category: 'Beverages',
      unit: 'pack',
      sellingPrice: '60',
      active: true,
      reorderThresholds: [{ storeCode: 'B01', threshold: 3 }],
    });
  });

  it('shows the Thai error when the SKU already exists', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': stores,
      'GET /products': page([product('SKU001', 'Drinking water pack of 6')]),
      'POST /products': apiError(
        409,
        'CONFLICT',
        'รหัสสินค้า (SKU) SKU001 ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น',
      ),
    });

    renderPage();

    fireEvent.change(await screen.findByLabelText('รหัสสินค้า (SKU)'), {
      target: { value: 'SKU001' },
    });
    fireEvent.change(screen.getByLabelText('ชื่อสินค้า'), { target: { value: 'ซ้ำ' } });
    fireEvent.change(screen.getByLabelText('หมวดหมู่'), { target: { value: 'Beverages' } });
    fireEvent.change(screen.getByLabelText('หน่วยนับ'), { target: { value: 'pack' } });
    fireEvent.change(screen.getByLabelText('ราคาขาย (บาท)'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มสินค้า' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('รหัสสินค้า (SKU) SKU001 ถูกใช้งานแล้ว'),
    );
  });

  it('shows what to fix when the API rejects a negative price', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': stores,
      'GET /products': page([]),
      'POST /products': apiError(400, 'BAD_REQUEST', 'Input validation failed', {
        issues: [{ message: 'ราคาขายต้องไม่ติดลบ', path: ['sellingPrice'] }],
      }),
    });

    renderPage();

    fireEvent.change(await screen.findByLabelText('รหัสสินค้า (SKU)'), {
      target: { value: 'SKU009' },
    });
    fireEvent.change(screen.getByLabelText('ชื่อสินค้า'), { target: { value: 'ติดลบ' } });
    fireEvent.change(screen.getByLabelText('หมวดหมู่'), { target: { value: 'Beverages' } });
    fireEvent.change(screen.getByLabelText('หน่วยนับ'), { target: { value: 'pack' } });
    fireEvent.change(screen.getByLabelText('ราคาขาย (บาท)'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มสินค้า' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ราคาขายต้องไม่ติดลบ'));
  });

  it('lets an admin deactivate a product', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': stores,
      'GET /products': page([product('SKU001', 'Drinking water pack of 6')]),
      'POST /products/sku001/active': product('SKU001', 'Drinking water pack of 6', {
        active: false,
      }),
    });

    renderPage();

    const row = await screen.findByRole('row', { name: /SKU001/ });
    fireEvent.click(
      Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'ปิดใช้งาน') ?? row,
    );

    await waitFor(() => {
      const post = fetch.mock.calls.find(([request]) => (request as Request).method === 'POST');
      expect(post).toBeDefined();
    });
    const post = fetch.mock.calls.find(([request]) => (request as Request).method === 'POST');
    expect(await (post?.[0] as Request).json()).toMatchObject({ active: false });
  });
});
