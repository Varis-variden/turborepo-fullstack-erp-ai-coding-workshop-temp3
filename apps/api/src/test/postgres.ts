import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import type { Env } from '../config/env.js';

/** Same default as `config/env.ts`: the compose Postgres published on localhost. */
const DEFAULT_DATABASE_URL = 'postgresql://erp:erp@localhost:5432/erp';

/** A real `PrismaService` connected to the integration database. Call `$disconnect()` when done. */
export function createTestPrisma(): PrismaService {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const config = { get: () => url } as unknown as ConfigService<Env, true>;
  return new PrismaService(config);
}

/**
 * Creates a product and a store of its own with the given opening balance, so a spec never
 * touches the seeded rows other tests and the demo rely on. `cleanup()` removes everything the
 * spec wrote, movements included.
 */
export async function createStockFixture(prisma: PrismaService, openingQuantity: number) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const store = await prisma.store.create({ data: { code: `IT-${suffix}`, name: 'Integration' } });
  const product = await prisma.product.create({
    data: {
      sku: `IT-${suffix}`,
      name: 'Integration product',
      category: 'Test',
      unit: 'pack',
      sellingPrice: '1.00',
    },
  });
  await prisma.stockBalance.create({
    data: { productId: product.id, storeId: store.id, quantity: openingQuantity },
  });

  return {
    productId: product.id,
    storeId: store.id,
    balance: async () =>
      (
        await prisma.stockBalance.findUnique({
          where: { productId_storeId: { productId: product.id, storeId: store.id } },
        })
      )?.quantity,
    movements: () =>
      prisma.stockMovement.findMany({
        where: { productId: product.id, storeId: store.id },
        orderBy: { createdAt: 'asc' },
      }),
    cleanup: async () => {
      await prisma.stockMovement.deleteMany({ where: { productId: product.id } });
      await prisma.stockBalance.deleteMany({ where: { productId: product.id } });
      await prisma.product.delete({ where: { id: product.id } });
      await prisma.store.delete({ where: { id: store.id } });
    },
  };
}
