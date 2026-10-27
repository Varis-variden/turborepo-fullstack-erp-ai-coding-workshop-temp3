import type { User } from '@erp/contracts';
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { AuditController } from './audit.controller.js';

const manager: User = {
  id: 'u-mgr',
  email: 'manager01@erp.local',
  name: 'Manager 01',
  role: 'MANAGER',
  storeId: null,
};
const staffB01: User = {
  id: 'u-b01',
  email: 'staff_b01@erp.local',
  name: 'Staff B01',
  role: 'STAFF',
  storeId: 'B01',
};

// An AuditLog row as Prisma returns it, with the store relation and the actor loaded.
const auditRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  action: 'STOCK_ADJUSTMENT',
  actorId: 'u-mgr',
  sourceType: 'ADJUSTMENT',
  sourceId: 'm1',
  outcome: 'POSTED',
  detail: 'นับสต็อกใหม่',
  createdAt: new Date('2026-10-27T00:00:00Z'),
  store: { code: 'B01' },
  ...overrides,
});

async function createController(stubs: { auditLog?: object; user?: object }) {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuditController],
    providers: [{ provide: PrismaService, useValue: { auditLog: {}, user: {}, ...stubs } }],
  }).compile();
  return moduleRef.get(AuditController);
}

describe('AuditController.list', () => {
  it('returns audit entries newest first with the store code, actor name and ISO timestamp', async () => {
    const findMany = vi.fn().mockResolvedValue([auditRow()]);
    const count = vi.fn().mockResolvedValue(1);
    const findMany2 = vi.fn().mockResolvedValue([{ id: 'u-mgr', name: 'Manager 01' }]);
    const controller = await createController({
      auditLog: { findMany, count },
      user: { findMany: findMany2 },
    });

    const result = await call(controller.list(manager), { page: 1, pageSize: 20 });

    expect(count).toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({
      id: 'a1',
      action: 'STOCK_ADJUSTMENT',
      actorId: 'u-mgr',
      actorName: 'Manager 01',
      storeCode: 'B01',
      sourceType: 'ADJUSTMENT',
      sourceId: 'm1',
      outcome: 'POSTED',
      detail: 'นับสต็อกใหม่',
      createdAt: '2026-10-27T00:00:00.000Z',
    });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ orderBy: { createdAt: 'desc' } });
  });

  it('falls back to the actor id when the user is no longer found', async () => {
    const findMany = vi.fn().mockResolvedValue([auditRow({ actorId: 'u-gone' })]);
    const count = vi.fn().mockResolvedValue(1);
    const controller = await createController({
      auditLog: { findMany, count },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    });

    const result = await call(controller.list(manager), { page: 1, pageSize: 20 });

    expect(result.items[0]?.actorName).toBe('u-gone');
  });

  it('narrows to one store when a store code is given', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({
      auditLog: { findMany, count },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    });

    await call(controller.list(manager), { page: 1, pageSize: 20, storeCode: 'B01' });

    expect(findMany.mock.calls[0]?.[0].where).toEqual({ store: { code: 'B01' } });
  });

  it('asks for the right slice on a later page', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const controller = await createController({
      auditLog: { findMany, count },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    });

    await call(controller.list(manager), { page: 2, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
  });

  it('rejects a store user asking for another store with FORBIDDEN, and queries nothing', async () => {
    const findMany = vi.fn();
    const count = vi.fn();
    const controller = await createController({
      auditLog: { findMany, count },
      user: { findMany: vi.fn() },
    });

    await expect(
      call(controller.list(staffB01), { page: 1, pageSize: 20, storeCode: 'B02' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});
