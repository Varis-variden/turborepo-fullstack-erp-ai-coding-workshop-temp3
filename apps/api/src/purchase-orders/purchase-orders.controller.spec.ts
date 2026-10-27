import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '@erp/contracts';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';

// Prisma hands back a Decimal; the handler only relies on `toFixed`, so a stand-in is enough.
const decimal = (value: string) => ({ toFixed: (digits: number) => Number(value).toFixed(digits) });

const buyer: User = {
  id: 'u-buyer',
  email: 'buyer01@erp.local',
  name: 'Buyer 01',
  role: 'PURCHASING',
  storeId: null,
};

const supplier = { id: 'sup1', code: 'SUP01', name: 'SupplyOne Co Ltd' };
const store = { id: 'st1', code: 'B01', name: 'Central Store' };
const water = {
  id: 'p1',
  sku: 'SKU001',
  name: 'Drinking water pack of 6',
  unit: 'pack',
  active: true,
};
const tissue = { id: 'p2', sku: 'SKU002', name: 'Tissue paper', unit: 'pack', active: true };

const input = {
  supplierCode: 'SUP01',
  storeCode: 'B01',
  expectedReceiptDate: '2026-02-01',
  lines: [{ sku: 'SKU001', quantity: 20, unitPrice: '45' }],
};

// A PurchaseOrder row as Prisma returns it, with supplier, store and lines included.
function orderRow(number: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'po1',
    number,
    status: 'DRAFT',
    expectedReceiptDate: new Date('2026-02-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    supplier,
    store,
    lines: [
      {
        id: 'l1',
        sku: 'SKU001',
        productName: 'Drinking water pack of 6',
        unit: 'pack',
        quantity: 20,
        unitPrice: decimal('45'),
      },
    ],
    ...overrides,
  };
}

interface Stubs {
  /** What the next allocation of a document number returns (the sequence row after increment). */
  sequenceValue?: number;
  supplier?: object | null;
  store?: object | null;
  products?: object[];
}

/**
 * The create handler reads suppliers, stores and products on the plain client, then allocates the
 * number and writes the order on the transaction client. Only the transaction client has
 * `documentSequence` and `purchaseOrder.create`, so a number allocated outside the transaction
 * would fail these tests.
 */
async function createController(stubs: Stubs = {}) {
  const upsert = vi.fn().mockResolvedValue({ type: 'PO', lastValue: stubs.sequenceValue ?? 1 });
  const create = vi.fn(async ({ data }: { data: { number: string } }) => orderRow(data.number));
  const tx = { documentSequence: { upsert }, purchaseOrder: { create } };
  const prisma = {
    supplier: { findUnique: vi.fn().mockResolvedValue('supplier' in stubs ? stubs.supplier : supplier) },
    store: { findUnique: vi.fn().mockResolvedValue('store' in stubs ? stubs.store : store) },
    product: { findMany: vi.fn().mockResolvedValue(stubs.products ?? [water]) },
    purchaseOrder: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [PurchaseOrdersController],
    providers: [{ provide: PrismaService, useValue: prisma }],
  }).compile();
  return { controller: moduleRef.get(PurchaseOrdersController), prisma, tx, upsert, create };
}

describe('PurchaseOrdersController.create', () => {
  it('creates a draft with the supplier, store, date and line, and returns it with its PO- number', async () => {
    const { controller } = await createController();

    const result = await call(controller.create(buyer), input);

    expect(result).toEqual({
      id: 'po1',
      number: 'PO-001',
      status: 'DRAFT',
      supplierCode: 'SUP01',
      supplierName: 'SupplyOne Co Ltd',
      storeCode: 'B01',
      storeName: 'Central Store',
      expectedReceiptDate: '2026-02-01',
      createdAt: '2026-01-01T00:00:00.000Z',
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
    });
  });

  it('numbers the order from a per-type sequence, zero-padded, allocated inside the transaction', async () => {
    const { controller, prisma, upsert, create } = await createController({ sequenceValue: 7 });

    const result = await call(controller.create(buyer), input);

    expect(result.number).toBe('PO-007');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { type: 'PO' },
      create: { type: 'PO', lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ number: 'PO-007' }) }),
    );
  });

  it('keeps counting past the padding width', async () => {
    const { controller } = await createController({ sequenceValue: 1234 });

    await expect(call(controller.create(buyer), input)).resolves.toMatchObject({
      number: 'PO-1234',
    });
  });

  it('stores a snapshot of each product (SKU, name, unit) with the purchase price at creation', async () => {
    const { controller, create } = await createController({ products: [water, tissue] });

    await call(controller.create(buyer), {
      ...input,
      lines: [
        { sku: 'SKU001', quantity: 20, unitPrice: '45' },
        { sku: 'SKU002', quantity: 3, unitPrice: '0' },
      ],
    });

    const data = create.mock.calls[0]?.[0].data as unknown as {
      supplierId: string;
      storeId: string;
      createdById: string;
      expectedReceiptDate: Date;
      lines: { create: unknown[] };
    };
    expect(data).toMatchObject({
      supplierId: 'sup1',
      storeId: 'st1',
      createdById: 'u-buyer',
      expectedReceiptDate: new Date('2026-02-01T00:00:00Z'),
    });
    expect(data.lines.create).toEqual([
      {
        productId: 'p1',
        sku: 'SKU001',
        productName: 'Drinking water pack of 6',
        unit: 'pack',
        quantity: 20,
        unitPrice: '45.00',
      },
      {
        productId: 'p2',
        sku: 'SKU002',
        productName: 'Tissue paper',
        unit: 'pack',
        quantity: 3,
        unitPrice: '0.00',
      },
    ]);
  });

  it('rejects a duplicate SKU in one order before touching the database', async () => {
    const { controller, prisma } = await createController();

    await expect(
      call(controller.create(buyer), {
        ...input,
        lines: [
          { sku: 'SKU001', quantity: 1, unitPrice: '45' },
          { sku: 'sku001', quantity: 2, unitPrice: '45' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['a zero quantity', { sku: 'SKU001', quantity: 0, unitPrice: '45' }],
    ['a fractional quantity', { sku: 'SKU001', quantity: 1.5, unitPrice: '45' }],
    ['a negative price', { sku: 'SKU001', quantity: 1, unitPrice: '-1' }],
  ])('rejects %s and allocates no number', async (_label, line) => {
    const { controller, prisma } = await createController();

    await expect(call(controller.create(buyer), { ...input, lines: [line] })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an order with no lines', async () => {
    const { controller } = await createController();

    await expect(call(controller.create(buyer), { ...input, lines: [] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('rejects an unknown supplier with an actionable message and allocates no number', async () => {
    const { controller, prisma } = await createController({ supplier: null });

    await expect(call(controller.create(buyer), input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ไม่พบผู้จัดจำหน่าย SUP01 กรุณาตรวจสอบรหัสผู้จัดจำหน่าย',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown destination store', async () => {
    const { controller } = await createController({ store: null });

    await expect(call(controller.create(buyer), input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ไม่พบสาขา B01 กรุณาตรวจสอบรหัสสาขา',
    });
  });

  it('rejects an unknown SKU', async () => {
    const { controller, prisma } = await createController({ products: [] });

    await expect(call(controller.create(buyer), input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ไม่พบสินค้า SKU001 กรุณาตรวจสอบรหัสสินค้า (SKU)',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a deactivated product: it cannot go on a new document', async () => {
    const { controller, prisma } = await createController({
      products: [{ ...water, active: false }],
    });

    await expect(call(controller.create(buyer), input)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'สินค้า SKU001 ปิดใช้งานแล้ว ไม่สามารถเพิ่มในใบสั่งซื้อใหม่ได้',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is restricted to purchasing officers at the API', () => {
    const roles = new Reflector().get(ROLES_KEY, PurchaseOrdersController.prototype.create);

    expect(roles).toEqual(['PURCHASING']);
  });
});

describe('PurchaseOrdersController.list', () => {
  it('returns a newest-first page of orders with their lines', async () => {
    const { controller, prisma } = await createController();
    prisma.purchaseOrder.findMany.mockResolvedValue([orderRow('PO-002'), orderRow('PO-001')]);
    prisma.purchaseOrder.count.mockResolvedValue(2);

    const result = await call(controller.list(), { page: 1, pageSize: 20 });

    expect(result.total).toBe(2);
    expect(result.items.map((order) => order.number)).toEqual(['PO-002', 'PO-001']);
    expect(result.items[0]?.lines[0]).toMatchObject({ sku: 'SKU001', unitPrice: '45.00' });
    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 0, take: 20 }),
    );
  });

  it('is visible to purchasing, managers and admins only', () => {
    const roles = new Reflector().get(ROLES_KEY, PurchaseOrdersController.prototype.list);

    expect(roles).toEqual(['PURCHASING', 'MANAGER', 'ADMIN']);
  });
});
