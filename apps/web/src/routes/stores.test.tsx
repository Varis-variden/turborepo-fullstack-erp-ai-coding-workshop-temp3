import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { mockApi } from '@/test/mock-api';
import { StoresPage } from './stores';

const admin = { id: '1', email: 'admin@erp.local', name: 'Admin', role: 'ADMIN', storeId: null };
const staff = { id: '2', email: 'staff@erp.local', name: 'Staff', role: 'STAFF', storeId: 'B01' };

const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, total: items.length });
const store = (code: string, name: string) => ({
  id: code,
  code,
  name,
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
      <StoresPage />
    </QueryClientProvider>,
  );
}

describe('StoresPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists stores returned by the API', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': page([store('B01', 'Central Store'), store('B02', 'Riverside Store')]),
    });

    renderPage();

    expect(await screen.findByText('Central Store')).toBeInTheDocument();
    expect(await screen.findByText('Riverside Store')).toBeInTheDocument();
  });

  it('shows a clear empty state when there are no stores', async () => {
    mockApi({ 'GET /auth/me': { user: admin }, 'GET /stores': page([]) });

    renderPage();

    expect(await screen.findByText('ยังไม่มีสาขา')).toBeInTheDocument();
  });

  it('shows an error state when the list request fails', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': Response.json(
        { defined: false, code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'เกิดข้อผิดพลาด' },
        { status: 500 },
      ),
    });

    renderPage();

    expect(await screen.findByText(/เกิดข้อผิดพลาด/)).toBeInTheDocument();
  });

  it('hides the create form from a non-admin', async () => {
    mockApi({ 'GET /auth/me': { user: staff }, 'GET /stores': page([]) });

    renderPage();

    await screen.findByText('ยังไม่มีสาขา');
    expect(screen.queryByLabelText('รหัสสาขา')).not.toBeInTheDocument();
  });

  it('lets an admin see the create form and shows the Thai error on a duplicate code', async () => {
    mockApi({
      'GET /auth/me': { user: admin },
      'GET /stores': page([store('B01', 'Central Store')]),
      'POST /stores': Response.json(
        {
          defined: false,
          code: 'CONFLICT',
          status: 409,
          message: 'รหัสสาขา B01 ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น',
        },
        { status: 409 },
      ),
    });

    renderPage();

    const code = await screen.findByLabelText('รหัสสาขา');
    fireEvent.change(code, { target: { value: 'B01' } });
    fireEvent.change(screen.getByLabelText('ชื่อสาขา'), { target: { value: 'ซ้ำ' } });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มสาขา' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('รหัสสาขา B01 ถูกใช้งานแล้ว'),
    );
  });
});
