import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { StockAdjustmentsPage } from './stock-adjustments';

const manager = {
  id: 'u-mgr',
  email: 'manager01@erp.local',
  name: 'Manager 01',
  role: 'MANAGER',
  storeId: null,
};

const iso = '2026-10-27T00:00:00.000Z';
const pageOf = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const stores = pageOf([
  { id: 's1', code: 'B01', name: 'Central Store', createdAt: iso },
  { id: 's2', code: 'B02', name: 'Riverside Store', createdAt: iso },
]);

const auditEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  action: 'STOCK_ADJUSTMENT',
  actorId: 'u-mgr',
  actorName: 'Manager 01',
  storeCode: 'B01',
  sourceType: 'ADJUSTMENT',
  sourceId: 'm1',
  outcome: 'POSTED',
  detail: 'นับสต็อกใหม่',
  createdAt: iso,
  ...overrides,
});

function apiError(status: number, code: string, message: string, data?: unknown) {
  return Response.json({ defined: false, code, status, message, data }, { status });
}

function testQueryClient(): QueryClient {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  return client;
}

function renderPage() {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <StockAdjustmentsPage />
    </QueryClientProvider>,
  );
}

async function fillForm(sku: string, store: string, change: string, reason: string) {
  await screen.findByRole('option', { name: /B01/ });
  fireEvent.change(screen.getByLabelText('รหัสสินค้า (SKU)'), { target: { value: sku } });
  fireEvent.change(screen.getByLabelText('สาขา'), { target: { value: store } });
  fireEvent.change(screen.getByLabelText('จำนวนที่ปรับ (+ เพิ่ม / - ลด)'), {
    target: { value: change },
  });
  fireEvent.change(screen.getByLabelText('เหตุผล'), { target: { value: reason } });
}

describe('StockAdjustmentsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits an adjustment and shows the new balance', async () => {
    const fetch = mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': stores,
      'GET /audit': pageOf([]),
      'POST /inventory/adjustments': {
        sku: 'SKU001',
        storeCode: 'B01',
        quantityChange: 5,
        balanceBefore: 10,
        balanceAfter: 15,
      },
    });

    renderPage();
    await fillForm('SKU001', 'B01', '5', 'นับสต็อกใหม่');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับสต็อก' }));

    const request = await waitFor(() => {
      const found = fetch.mock.calls.find(([r]) => r.method === 'POST');
      if (!found) throw new Error('not posted yet');
      return found[0];
    });
    expect(await request.clone().json()).toEqual({
      sku: 'SKU001',
      storeCode: 'B01',
      quantityChange: 5,
      reason: 'นับสต็อกใหม่',
    });

    expect(await screen.findByRole('status')).toHaveTextContent('15');
  });

  it('shows the rejection when a reduction is greater than the available balance', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': stores,
      'GET /audit': pageOf([]),
      'POST /inventory/adjustments': apiError(409, 'CONFLICT', 'สต็อกสินค้าไม่เพียงพอ'),
    });

    renderPage();
    await fillForm('SKU001', 'B01', '-999', 'ของเสีย');
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการปรับสต็อก' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('สต็อกสินค้าไม่เพียงพอ');
  });

  it('lists recent audit entries with the action, store, outcome and reason', async () => {
    mockApi({
      'GET /auth/me': { user: manager },
      'GET /stores': stores,
      'GET /audit': pageOf([auditEntry()]),
    });

    renderPage();

    const row = await screen.findByRole('row', { name: /นับสต็อกใหม่/ });
    expect(row).toHaveTextContent('B01');
    expect(row).toHaveTextContent('Manager 01');
    expect(row).toHaveTextContent('สำเร็จ');
  });
});
