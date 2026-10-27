import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { InventoryPage } from './inventory';

const manager = {
  id: '1',
  email: 'manager01@erp.local',
  name: 'Manager',
  role: 'MANAGER',
  storeId: null,
};
const staff = {
  id: '2',
  email: 'staff_b01@erp.local',
  name: 'Staff',
  role: 'STAFF',
  storeId: 'B01',
};

const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const stock = (
  sku: string,
  name: string,
  quantity: number,
  overrides: Record<string, unknown> = {},
) => ({
  productId: sku.toLowerCase(),
  sku,
  name,
  unit: 'pack',
  storeCode: 'B01',
  quantity,
  reorderThreshold: 3,
  lowStock: quantity <= 3,
  ...overrides,
});
const stores = page([
  { id: 's1', code: 'B01', name: 'Central Store', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 's2', code: 'B02', name: 'Riverside Store', createdAt: '2026-01-01T00:00:00.000Z' },
]);

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
      <InventoryPage />
    </QueryClientProvider>,
  );
}

describe('InventoryPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists stock with quantity, unit, threshold and a low-stock badge', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': stores,
      'GET /inventory/stock': page([
        stock('SKU001', 'Drinking water pack of 6', 10),
        stock('SKU002', 'Tissue paper', 5),
        stock('SKU003', 'Laundry detergent', 0),
      ]),
    });

    renderPage();

    const water = await screen.findByRole('row', { name: /SKU001/ });
    expect(water).toHaveTextContent('Drinking water pack of 6');
    expect(water).toHaveTextContent('10');
    expect(water).toHaveTextContent('pack');
    expect(water).toHaveTextContent('3');

    const detergent = screen.getByRole('row', { name: /SKU003/ });
    expect(detergent).toHaveTextContent('สต็อกต่ำ');
    expect(screen.getByRole('row', { name: /SKU001/ })).not.toHaveTextContent('สต็อกต่ำ');
  });

  it('shows a clear empty state when nothing matches', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': stores,
      'GET /inventory/stock': page([]),
    });

    renderPage();

    expect(await screen.findByText('ไม่พบสินค้าในสต็อก')).toBeInTheDocument();
  });

  it('shows an error state when the search request fails', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': stores,
      'GET /inventory/stock': apiError(500, 'INTERNAL_SERVER_ERROR', 'เกิดข้อผิดพลาด'),
    });

    renderPage();

    expect(await screen.findByText(/เกิดข้อผิดพลาด/)).toBeInTheDocument();
  });

  it('sends the typed search term to the API', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': stores,
      'GET /inventory/stock': page([stock('SKU001', 'Drinking water pack of 6', 10)]),
    });
    const searches = () =>
      fetch.mock.calls
        .map(([request]) => new URL((request as Request).url))
        .filter((url) => url.pathname === '/api/inventory/stock')
        .map((url) => url.searchParams.get('search'));

    renderPage();
    await screen.findByRole('row', { name: /SKU001/ });

    fireEvent.change(screen.getByLabelText('ค้นหาด้วยรหัสสินค้าหรือชื่อสินค้า'), {
      target: { value: 'water' },
    });

    await waitFor(() => expect(searches()).toContain('water'));
  });

  it('lets a manager filter by store', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': stores,
      'GET /inventory/stock': page([stock('SKU001', 'Drinking water pack of 6', 10)]),
    });
    const storeCodes = () =>
      fetch.mock.calls
        .map(([request]) => new URL((request as Request).url))
        .filter((url) => url.pathname === '/api/inventory/stock')
        .map((url) => url.searchParams.get('storeCode'));

    renderPage();
    await screen.findByRole('row', { name: /SKU001/ });

    fireEvent.change(screen.getByLabelText('สาขา'), { target: { value: 'B02' } });

    await waitFor(() => expect(storeCodes()).toContain('B02'));
  });

  it('hides the store filter from a store-scoped user', async () => {
    mockApi({
      'GET /auth/me': { user: staff },
      'GET /stores': stores,
      'GET /inventory/stock': page([stock('SKU001', 'Drinking water pack of 6', 10)]),
    });

    renderPage();

    await screen.findByRole('row', { name: /SKU001/ });
    expect(screen.queryByLabelText('สาขา')).not.toBeInTheDocument();
  });
});
