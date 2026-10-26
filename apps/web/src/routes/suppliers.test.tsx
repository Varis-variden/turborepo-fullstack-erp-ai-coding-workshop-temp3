import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { SuppliersPage } from './suppliers';

const admin = { id: '1', email: 'admin@erp.local', name: 'Admin', role: 'ADMIN', storeId: null };
const staff = { id: '2', email: 'staff@erp.local', name: 'Staff', role: 'STAFF', storeId: 'B01' };

const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const supplier = (code: string, name: string) => ({
  id: code,
  code,
  name,
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

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
      <SuppliersPage />
    </QueryClientProvider>,
  );
}

describe('SuppliersPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists suppliers returned by the API', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /suppliers': page([
        supplier('SUP01', 'SupplyOne Co Ltd'),
        supplier('SUP02', 'SupplyTwo Co Ltd'),
      ]),
    });

    renderPage();

    expect(await screen.findByText('SupplyOne Co Ltd')).toBeInTheDocument();
    expect(await screen.findByText('SupplyTwo Co Ltd')).toBeInTheDocument();
  });

  it('shows a clear empty state when there are no suppliers', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /suppliers': page([]) });

    renderPage();

    expect(await screen.findByText('ยังไม่มีผู้จัดจำหน่าย')).toBeInTheDocument();
  });

  it('shows an error state when the list request fails', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /suppliers': Response.json(
        { defined: false, code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'เกิดข้อผิดพลาด' },
        { status: 500 },
      ),
    });

    renderPage();

    expect(await screen.findByText(/เกิดข้อผิดพลาด/)).toBeInTheDocument();
  });

  it('hides the create form from a non-admin', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /suppliers': page([]) });

    renderPage();

    await screen.findByText('ยังไม่มีผู้จัดจำหน่าย');
    expect(screen.queryByLabelText('รหัสผู้จัดจำหน่าย')).not.toBeInTheDocument();
  });

  it('lets an admin see the create form and shows the Thai error on a duplicate code', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /suppliers': page([supplier('SUP01', 'SupplyOne Co Ltd')]),
      'POST /suppliers': Response.json(
        {
          defined: false,
          code: 'CONFLICT',
          status: 409,
          message: 'รหัสผู้จัดจำหน่าย SUP01 ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น',
        },
        { status: 409 },
      ),
    });

    renderPage();

    const code = await screen.findByLabelText('รหัสผู้จัดจำหน่าย');
    fireEvent.change(code, { target: { value: 'SUP01' } });
    fireEvent.change(screen.getByLabelText('ชื่อผู้จัดจำหน่าย'), { target: { value: 'ซ้ำ' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มผู้จัดจำหน่าย' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('รหัสผู้จัดจำหน่าย SUP01 ถูกใช้งานแล้ว'),
    );
  });
});
