import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '@erp/contracts';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { SalesController } from './sales.controller.js';

// Prisma hands back a Decimal; the handler only relies on `toFixed`, so a stand-in is enough.
const decimal = (value: string) => ({ toFixed: (digits: number) => Number(value).toFixed(digits) });

const staff: User = {
  id: 'u-staff',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STAFF',
  storeId: 'B01',
};

const store = { id: 'st1', code: 'B01', name: 'Central Store' };
const water = {
  id: 'p1',
  sku: 'SKU001',
  name: 'Drinking water pack of 6',
  unit: 'pack',
  sellingPrice: decimal('60'),
  active: true,
};
const tissue = {
  id: 'p2',
  sku: 'SKU002',
  name: 'Tissue paper',
  unit: 'pack',
  sellingPrice: decimal('35'),
  active: true,
};

const input = { lines: [{ sku: 'SKU001', quantity: 2 }] };

// A Sale row as Prisma returns it, assembled from the data the create was called with.
function saleRow(data: {
  number: string;
  storeId: string;
  total: string;
  lines: { create: { sku: string; productName: string; unit: string; quantity: number; unitPrice: string; lineAmount: string }[] };
}) {
  return {
    id: 's1',
    number: data.number,
    total: decimal(data.total),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    store,
    lines: data.lines.create.map((line, index) => ({
      id: `l${index + 1}`,
      sku: line.sku,
      productName: line.productName,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: decimal(line.unitPrice),
      lineAmount: decimal(line.lineAmount),
    })),
  };
}

interface Stubs {
  sequenceValue?: number;
  store?: object | null;
  products?: object[];
}

async function createController(stubs: Stubs = {}) {
  const upsert = vi.fn().mockResolvedValue({ type: 'SAL', lastValue: stubs.sequenceValue ?? 1 });
  const create = vi.fn(async ({ data }: { data: Parameters<typeof saleRow>[0] }) => saleRow(data));
  const stockMovementCreate = vi.fn();
  const stockBalanceUpsert = vi.fn();
  const tx = {
    documentSequence: { upsert },
    sale: { create },
    stockMovement: { create: stockMovementCreate },
    stockBalance: { upsert: stockBalanceUpsert },
  };
  const prisma = {
    store: { findUnique: vi.fn().mockResolvedValue('store' in stubs ? stubs.store : store) },
    product: { findMany: vi.fn().mockResolvedValue(stubs.products ?? [water]) },
    sale: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [SalesController],
    providers: [{ provide: PrismaService, useValue: prisma }],
  }).compile();
  return {
    controller: moduleRef.get(SalesController),
    prisma,
    tx,
    upsert,
    create,
    stockMovementCreate,
    stockBalanceUpsert,
  };
}

describe('SalesController.create', () => {
  it('creates a draft sale at the caller’s store with its SAL- number, line amounts and total', async () => {
    const { controller } = await createController({ products: [water, tissue] });

    const result = await call(controller.create(staff), {
      lines: [
        { sku: 'SKU001', quantity: 2 },
        { sku: 'SKU002', quantity: 1 },
      ],
    });

    expect(result).toEqual({
      id: 's1',
      number: 'SAL-001',
      storeCode: 'B01',
      storeName: 'Central Store',
      createdAt: '2026-01-01T00:00:00.000Z',
      total: '155.00',
      lines: [
        {
          id: 'l1',
          sku: 'SKU001',
          name: 'Drinking water pack of 6',
          unit: 'pack',
          quantity: 2,
          unitPrice: '60.00',
          lineAmount: '120.00',
        },
        {
          id: 'l2',
          sku: 'SKU002',
          name: 'Tissue paper',
          unit: 'pack',
          quantity: 1,
          unitPrice: '35.00',
          lineAmount: '35.00',
        },
      ],
    });
  });

  it('scopes the sale to the caller’s own store, taken from the user and not the input', async () => {
    const { controller, prisma, create } = await createController();

    await call(controller.create(staff), input);

    expect(prisma.store.findUnique).toHaveBeenCalledWith({ where: { code: 'B01' } });
    expect(create.mock.calls[0]?.[0].data).toMatchObject({ storeId: 'st1' });
  });

  it('applies the product’s current selling price and the caller cannot override it', async () => {
    const { controller, create } = await createController();

    // An input that smuggles a unitPrice is ignored: the snapshot is the product's price.
    await call(controller.create(staff), {
      lines: [{ sku: 'SKU001', quantity: 2, unitPrice: '1.00' }],
    } as unknown as typeof input);

    expect(create.mock.calls[0]?.[0].data.lines.create[0]).toMatchObject({
      unitPrice: '60.00',
      lineAmount: '120.00',
    });
  });

  it('snapshots each product’s SKU, name and unit onto its line', async () => {
    const { controller, create } = await createController({ products: [water] });

    await call(controller.create(staff), input);

    expect(create.mock.calls[0]?.[0].data.lines.create[0]).toMatchObject({
      productId: 'p1',
      sku: 'SKU001',
      productName: 'Drinking water pack of 6',
      unit: 'pack',
      quantity: 2,
    });
  });

  it('sums the line amounts into the document total, to two decimals', async () => {
    const { controller, create } = await createController({ products: [water, tissue] });

    await call(controller.create(staff), {
      lines: [
        { sku: 'SKU001', quantity: 2 },
        { sku: 'SKU002', quantity: 1 },
      ],
    });

    expect(create.mock.calls[0]?.[0].data.total).toBe('155.00');
  });

  it('numbers the sale from the SAL sequence, zero-padded, allocated inside the transaction', async () => {
    const { controller, prisma, upsert, create } = await createController({ sequenceValue: 7 });

    const result = await call(controller.create(staff), input);

    expect(result.number).toBe('SAL-007');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { type: 'SAL' },
      create: { type: 'SAL', lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ number: 'SAL-007' }) }),
    );
  });

  it('does not reduce stock: no movement and no balance change is written (SAL-02)', async () => {
    const { controller, stockMovementCreate, stockBalanceUpsert } = await createController();

    await call(controller.create(staff), input);

    expect(stockMovementCreate).not.toHaveBeenCalled();
    expect(stockBalanceUpsert).not.toHaveBeenCalled();
  });

  it('rejects a duplicate SKU in one sale before touching the database', async () => {
    const { controller, prisma } = await createController();

    await expect(
      call(controller.create(staff), {
        lines: [
          { sku: 'SKU001', quantity: 1 },
          { sku: 'sku001', quantity: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a zero quantity', { sku: 'SKU001', quantity: 0 }],
    ['a fractional quantity', { sku: 'SKU001', quantity: 1.5 }],
  ])('rejects %s and allocates no number', async (_label, line) => {
    const { controller, prisma } = await createController();

    await expect(call(controller.create(staff), { lines: [line] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a sale with no lines', async () => {
    const { controller } = await createController();

    await expect(call(controller.create(staff), { lines: [] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects an unknown SKU and allocates no number', async () => {
    const { controller, prisma } = await createController({ products: [] });

    await expect(call(controller.create(staff), input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ไม่พบสินค้า SKU001 กรุณาตรวจสอบรหัสสินค้า (SKU)',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a deactivated product: it cannot go on a new document', async () => {
    const { controller, prisma } = await createController({
      products: [{ ...water, active: false }],
    });

    await expect(call(controller.create(staff), input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'สินค้า SKU001 ปิดใช้งานแล้ว ไม่สามารถเพิ่มในการขายใหม่ได้',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects the sale when the caller’s store cannot be found', async () => {
    const { controller, prisma } = await createController({ store: null });

    await expect(call(controller.create(staff), input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is restricted to store employees at the API', () => {
    const roles = new Reflector().get(ROLES_KEY, SalesController.prototype.create);

    expect(roles).toEqual(['STAFF']);
  });
});

describe('SalesController.list', () => {
  it('returns a newest-first page of the caller’s store sales with their lines', async () => {
    const { controller, prisma } = await createController();
    const row = saleRow({
      number: 'SAL-001',
      storeId: 'st1',
      total: '120.00',
      lines: {
        create: [
          {
            sku: 'SKU001',
            productName: 'Drinking water pack of 6',
            unit: 'pack',
            quantity: 2,
            unitPrice: '60.00',
            lineAmount: '120.00',
          },
        ],
      },
    });
    prisma.sale.findMany.mockResolvedValue([row]);
    prisma.sale.count.mockResolvedValue(1);

    const result = await call(controller.list(staff), { page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.items[0]?.number).toBe('SAL-001');
    expect(result.items[0]?.lines[0]).toMatchObject({ sku: 'SKU001', lineAmount: '120.00' });
    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store: { code: 'B01' } },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('is restricted to store employees at the API', () => {
    const roles = new Reflector().get(ROLES_KEY, SalesController.prototype.list);

    expect(roles).toEqual(['STAFF']);
  });
});
