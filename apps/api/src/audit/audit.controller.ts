import { Controller } from '@nestjs/common';
import { type AuditEntry, contract, type User } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { assertStoreScope } from '../auth/store-scope.js';
import { PrismaService } from '../database/prisma.service.js';

/** An AuditLog row with its store code included; the actor name is resolved separately. */
type AuditRow = {
  id: string;
  action: string;
  actorId: string;
  sourceType: string;
  sourceId: string | null;
  outcome: 'POSTED' | 'REJECTED';
  detail: string | null;
  createdAt: Date;
  store: { code: string };
};

function toAuditEntry(row: AuditRow, actorName: string): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    actorName,
    storeCode: row.store.code,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    outcome: row.outcome,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  };
}

@Controller()
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  // Only managers oversee audited actions (TOR: managers view reports across all stores; an
  // administrator's transaction rights are not granted automatically).
  @Roles('MANAGER')
  @Implement(contract.audit.list)
  list(@CurrentUser() user: User) {
    return implement(contract.audit.list).handler(async ({ input }) => {
      const { page, pageSize, storeCode } = input;

      // Store scope is enforced here, not in the UI (NFR-03). A store-bound reader asking for
      // another store is rejected with FORBIDDEN; an unassigned manager sees every store,
      // optionally narrowed by the requested store code. User.storeId holds the store code.
      if (storeCode) assertStoreScope(user, storeCode);
      const effectiveStoreCode = user.storeId ?? storeCode;

      const where = effectiveStoreCode ? { store: { code: effectiveStoreCode } } : {};

      const [rows, total] = await Promise.all([
        this.prisma.auditLog.findMany({
          where,
          include: { store: { select: { code: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.auditLog.count({ where }),
      ]);

      // Resolve actor names in one query; fall back to the id if the user is gone.
      const actorIds = [...new Set(rows.map((row) => row.actorId))];
      const actors = await this.prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(actors.map((actor) => [actor.id, actor.name]));

      const items = rows.map((row) => toAuditEntry(row, nameById.get(row.actorId) ?? row.actorId));
      return { items, page, pageSize, total };
    });
  }
}
