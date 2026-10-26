import { Controller } from '@nestjs/common';
import { contract, type Store } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { isUniqueConstraintError } from '../database/prisma-errors.js';

/** Prisma returns `createdAt` as a `Date`; the contract exposes it as an ISO string. */
function toStore(row: { id: string; code: string; name: string; createdAt: Date }): Store {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

@Controller()
export class StoresController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.stores.list)
  list() {
    return implement(contract.stores.list).handler(async ({ input }) => {
      const { page, pageSize } = input;
      const [items, total] = await Promise.all([
        this.prisma.store.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.store.count(),
      ]);
      return { items: items.map(toStore), page, pageSize, total };
    });
  }

  @Roles('ADMIN')
  @Implement(contract.stores.create)
  create() {
    return implement(contract.stores.create).handler(async ({ input }) => {
      try {
        return toStore(await this.prisma.store.create({ data: input }));
      } catch (error) {
        if (isUniqueConstraintError(error, 'code')) {
          throw new ORPCError('CONFLICT', {
            message: `รหัสสาขา ${input.code} ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น`,
          });
        }
        throw error;
      }
    });
  }
}
