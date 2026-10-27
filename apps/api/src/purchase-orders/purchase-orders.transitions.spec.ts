import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { PurchaseOrder, User } from '@erp/contracts';
import { ROLES_KEY } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';

type Status = PurchaseOrder['status'];

const decimal = (value: string) => ({ toFixed: (digits: number) => Number(value).toFixed(digits) });

const user = (id: string, role: User['role'], storeId: string | null = null): User => ({
  id,
  email: `${id}@erp.local`,
  name: id,
  role,
  storeId,
});
const creator = user('u-buyer', 'PURCHASING');
const otherBuyer = user('u-buyer2', 'PURCHASING');
const manager = user('u-manager', 'MANAGER');
const storeManagerB02 = user('u-manager-b02', 'MANAGER', 'B02');

const ALL_STATUSES: Status[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'PARTIALLY_RECEIVED',
  'COMPLETED',
];

/** A PurchaseOrder row as Prisma returns it, created by `creator`, destined for store B01. */
function orderRow(status: Status, overrides: Record<string, unknown> = {}) {
  return {
    id: 'po1',
    number: 'PO-001',
    status,
    reason: null,
    createdById: creator.id,
    expectedReceiptDate: new Date('2026-02-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    supplier: { code: 'SUP01', name: 'SupplyOne Co Ltd' },
    store: { id: 'st1', code: 'B01', name: 'Central Store' },
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

/**
 * The handlers read the order on the plain client, then write the new status (guarded by the
 * status that was read) and the audit row together on the transaction client. Stock is not
 * stubbed on either client: any call into it would throw, so these tests also prove a
 * transition never touches stock (PO-02).
 */
async function createController(
  current: Status | null,
  rowOverrides: Record<string, unknown> = {},
) {
  const row = current ? orderRow(current, rowOverrides) : null;
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const findUniqueOrThrow = vi.fn(async ({ where }: { where: { id: string } }) => ({
    ...(row ?? orderRow('DRAFT')),
    id: where.id,
    ...writtenStatus(updateMany),
  }));
  const auditCreate = vi.fn().mockResolvedValue({});
  const tx = {
    purchaseOrder: { updateMany, findUniqueOrThrow },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    purchaseOrder: { findUnique: vi.fn().mockResolvedValue(row) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [PurchaseOrdersController],
    providers: [{ provide: PrismaService, useValue: prisma }],
  }).compile();
  return {
    controller: moduleRef.get(PurchaseOrdersController),
    prisma,
    updateMany,
    auditCreate,
  };
}

/** Reflect what the update wrote, so the returned order shows the new status and reason. */
function writtenStatus(updateMany: ReturnType<typeof vi.fn>) {
  const data = updateMany.mock.calls[0]?.[0]?.data as
    { status: Status; reason?: string | null } | undefined;
  return data ? { status: data.status, reason: data.reason ?? null } : {};
}

type Action = 'submit' | 'approve' | 'reject' | 'cancel';

/** Run an action as a user, with a reason where the action takes one. */
function run(
  controller: PurchaseOrdersController,
  action: Action,
  actor: User,
  reason = 'Price too high',
) {
  switch (action) {
    case 'submit':
      return call(controller.submit(actor), { id: 'po1' });
    case 'approve':
      return call(controller.approve(actor), { id: 'po1' });
    case 'reject':
      return call(controller.reject(actor), { id: 'po1', reason });
    case 'cancel':
      return call(controller.cancel(actor), { id: 'po1', reason });
  }
}

/** Who may run each action, and which status it leads to. */
const actors: Record<Action, { actor: User; to: Status }> = {
  submit: { actor: creator, to: 'PENDING_APPROVAL' },
  approve: { actor: manager, to: 'APPROVED' },
  reject: { actor: manager, to: 'REJECTED' },
  cancel: { actor: creator, to: 'CANCELLED' },
};

/** The legal rows of the API-driven part of the transition table: action -> from statuses. */
const legalFrom: Record<Action, Status[]> = {
  submit: ['DRAFT'],
  approve: ['PENDING_APPROVAL'],
  reject: ['PENDING_APPROVAL'],
  cancel: ['DRAFT', 'PENDING_APPROVAL'],
};

const legalCases = (Object.keys(legalFrom) as Action[]).flatMap((action) =>
  legalFrom[action].map((from) => [action, from, actors[action].to] as const),
);
const illegalCases = (Object.keys(legalFrom) as Action[]).flatMap((action) =>
  ALL_STATUSES.filter((from) => !legalFrom[action].includes(from)).map(
    (from) => [action, from] as const,
  ),
);

describe('purchase-order state machine: legal transitions', () => {
  it.each(legalCases)('%s moves %s to %s', async (action, from, to) => {
    const { controller, updateMany } = await createController(from);

    const result = await run(controller, action, actors[action].actor);

    expect(result.status).toBe(to);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'po1', status: from },
      data: expect.objectContaining({ status: to }),
    });
  });

  it('lets a manager cancel a draft or pending order too', async () => {
    for (const from of ['DRAFT', 'PENDING_APPROVAL'] as const) {
      const { controller } = await createController(from);
      await expect(run(controller, 'cancel', manager)).resolves.toMatchObject({
        status: 'CANCELLED',
      });
    }
  });

  it('keeps the reason on a rejected or cancelled order', async () => {
    const rejected = await createController('PENDING_APPROVAL');
    await expect(
      run(rejected.controller, 'reject', manager, 'Price too high'),
    ).resolves.toMatchObject({ status: 'REJECTED', reason: 'Price too high' });
    expect(rejected.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'REJECTED', reason: 'Price too high' } }),
    );

    const cancelled = await createController('DRAFT');
    await expect(
      run(cancelled.controller, 'cancel', creator, 'Ordered by mistake'),
    ).resolves.toMatchObject({ status: 'CANCELLED', reason: 'Ordered by mistake' });
  });

  it('changes nothing but the status and reason: lines, quantities, prices and destination stay', async () => {
    const { controller, updateMany } = await createController('PENDING_APPROVAL');

    const result = await run(controller, 'approve', manager);

    const data = updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(['status']);
    expect(result).toMatchObject({
      storeCode: 'B01',
      lines: [{ sku: 'SKU001', quantity: 20, unitPrice: '45.00' }],
    });
  });
});

describe('purchase-order state machine: illegal transitions', () => {
  it.each(illegalCases)(
    '%s from %s is rejected with CONFLICT and writes nothing',
    async (action, from) => {
      const { controller, updateMany, auditCreate } = await createController(from);

      await expect(run(controller, action, actors[action].actor)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(updateMany).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    },
  );

  it('names the order and its status in the message', async () => {
    const { controller } = await createController('REJECTED');

    await expect(run(controller, 'approve', manager)).rejects.toMatchObject({
      message: expect.stringContaining('PO-001'),
    });
  });

  it('a rejected order is terminal: nothing moves it, resubmission needs a new order', async () => {
    for (const action of ['submit', 'approve', 'reject', 'cancel'] as const) {
      const { controller, updateMany } = await createController('REJECTED');
      await expect(run(controller, action, actors[action].actor)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('only Draft or Pending Approval orders can be cancelled (PO-04)', async () => {
    for (const from of ['APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED'] as const) {
      const { controller } = await createController(from);
      await expect(run(controller, 'cancel', manager)).rejects.toMatchObject({ code: 'CONFLICT' });
    }
  });

  it('loses the race cleanly: if the status changed since it was read, nothing is audited', async () => {
    const { controller, updateMany, auditCreate } = await createController('PENDING_APPROVAL');
    updateMany.mockResolvedValue({ count: 0 });

    await expect(run(controller, 'approve', manager)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for an order that does not exist', async () => {
    const { controller, updateMany } = await createController(null);

    await expect(run(controller, 'approve', manager)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('purchase-order state machine: who may act', () => {
  it('only the creator may submit a draft', async () => {
    const { controller, updateMany } = await createController('DRAFT');

    await expect(run(controller, 'submit', otherBuyer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a purchasing officer may cancel only an order they created', async () => {
    const { controller, updateMany } = await createController('PENDING_APPROVAL');

    await expect(run(controller, 'cancel', otherBuyer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a manager is not bound to the creator when cancelling', async () => {
    const { controller } = await createController('PENDING_APPROVAL');

    await expect(run(controller, 'cancel', manager)).resolves.toMatchObject({
      status: 'CANCELLED',
    });
  });

  it('a manager of another store cannot approve, reject or cancel (store scope)', async () => {
    for (const action of ['approve', 'reject', 'cancel'] as const) {
      const { controller, updateMany } = await createController('PENDING_APPROVAL');
      await expect(run(controller, action, storeManagerB02)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it('checks the actor before the state, so a stranger learns nothing about the status', async () => {
    const { controller } = await createController('APPROVED');

    await expect(run(controller, 'submit', otherBuyer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it.each([
    ['submit', ['PURCHASING']],
    ['approve', ['MANAGER']],
    ['reject', ['MANAGER']],
    ['cancel', ['PURCHASING', 'MANAGER']],
  ] as const)('%s is restricted to %j at the API', (action, expected) => {
    const roles = new Reflector().get(ROLES_KEY, PurchaseOrdersController.prototype[action]);

    expect(roles).toEqual(expected);
  });
});

describe('purchase-order state machine: reasons', () => {
  it.each(['reject', 'cancel'] as const)('%s needs a reason', async (action) => {
    const from = action === 'reject' ? 'PENDING_APPROVAL' : 'DRAFT';
    const { controller, updateMany } = await createController(from);

    await expect(run(controller, action, actors[action].actor, '   ')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('purchase-order state machine: audit (NFR-03)', () => {
  it('writes an approval to the audit log with the actor, store, order and outcome', async () => {
    const { controller, auditCreate } = await createController('PENDING_APPROVAL');

    await run(controller, 'approve', manager);

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        action: 'PURCHASE_ORDER_APPROVED',
        actorId: manager.id,
        storeId: 'st1',
        sourceType: 'PURCHASE_ORDER',
        sourceId: 'po1',
        outcome: 'POSTED',
        detail: 'PO-001',
      },
    });
  });

  it('writes a rejection to the audit log with its reason', async () => {
    const { controller, auditCreate } = await createController('PENDING_APPROVAL');

    await run(controller, 'reject', manager, 'Price too high');

    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        action: 'PURCHASE_ORDER_REJECTED',
        actorId: manager.id,
        storeId: 'st1',
        sourceType: 'PURCHASE_ORDER',
        sourceId: 'po1',
        outcome: 'POSTED',
        detail: 'PO-001: Price too high',
      },
    });
  });

  it('writes the audit row in the same transaction as the status change', async () => {
    const { controller, prisma, auditCreate } = await createController('PENDING_APPROVAL');
    auditCreate.mockRejectedValue(new Error('audit down'));

    await expect(run(controller, 'approve', manager)).rejects.toThrow('audit down');
    // Both writes went through the transaction client, so the failure rolls the status back.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each(['submit', 'cancel'] as const)(
    '%s is not an approval decision and is not audited',
    async (action) => {
      const { controller, auditCreate } = await createController('DRAFT');

      await run(controller, action, creator);

      expect(auditCreate).not.toHaveBeenCalled();
    },
  );
});

describe('purchase-order state machine: stock (PO-02)', () => {
  it('creating, submitting and approving never read or write stock', async () => {
    // The stubs carry no stockBalance, stockMovement or product: touching stock would throw.
    const draft = await createController('DRAFT');
    await run(draft.controller, 'submit', creator);

    const pending = await createController('PENDING_APPROVAL');
    await expect(run(pending.controller, 'approve', manager)).resolves.toMatchObject({
      status: 'APPROVED',
    });
  });
});
