import { Controller } from '@nestjs/common';
import { contract, type Supplier } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { isUniqueConstraintError } from '../database/prisma-errors.js';

/** Prisma returns `createdAt` as a `Date`; the contract exposes it as an ISO string. */
function toSupplier(row: {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: Date;
}): Supplier {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

@Controller()
export class SuppliersController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.suppliers.list)
  list() {
    return implement(contract.suppliers.list).handler(async ({ input }) => {
      const { page, pageSize } = input;
      const [items, total] = await Promise.all([
        this.prisma.supplier.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.supplier.count(),
      ]);
      return { items: items.map(toSupplier), page, pageSize, total };
    });
  }

  @Roles('ADMIN')
  @Implement(contract.suppliers.create)
  create() {
    return implement(contract.suppliers.create).handler(async ({ input }) => {
      try {
        return toSupplier(await this.prisma.supplier.create({ data: input }));
      } catch (error) {
        if (isUniqueConstraintError(error, 'code')) {
          throw new ORPCError('CONFLICT', {
            message: `รหัสผู้จัดจำหน่าย ${input.code} ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น`,
          });
        }
        throw error;
      }
    });
  }
}
