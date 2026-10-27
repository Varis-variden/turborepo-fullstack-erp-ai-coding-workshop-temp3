import { createPrismaClient, hashPassword, Role } from '../src/index.js';

const prisma = createPrismaClient(
  process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp',
);

// Demo accounts for the workshop (also shown on the login page). Re-running the seed resets them.
// Roles and store assignments follow the Retail ERP TOR (Sections 2 and 8).
const demoUsers = [
  { email: 'admin@erp.local', name: 'Admin User', role: Role.ADMIN, storeId: null },
  { email: 'buyer01@erp.local', name: 'Buyer 01', role: Role.PURCHASING, storeId: null },
  { email: 'staff_b01@erp.local', name: 'Staff B01', role: Role.STAFF, storeId: 'B01' },
  { email: 'staff_b02@erp.local', name: 'Staff B02', role: Role.STAFF, storeId: 'B02' },
  { email: 'manager01@erp.local', name: 'Manager 01', role: Role.MANAGER, storeId: null },
];
// Stores from the TOR Section 8 sample data. Each store is a distinct stock location.
const demoStores = [
  { code: 'B01', name: 'Central Store' },
  { code: 'B02', name: 'Riverside Store' },
];
// Suppliers from the TOR sample data (MD-03). A purchase order references one of these.
const demoSuppliers = [
  {
    code: 'SUP01',
    name: 'SupplyOne Co Ltd',
    contactName: 'Somchai Prasert',
    contactPhone: '02-123-4567',
    contactEmail: 'sales@supplyone.co.th',
  },
];
const DEMO_PASSWORD = 'password';

// Products and their TOR Section 8 opening balances for B01. Every product has a reorder
// threshold of 3 in every store; B02 holds zero of everything. The opening quantity is laid
// down as an ADJUSTMENT movement (no source document) with the StockBalance written to match,
// so the derived balance never drifts from the ledger (INV-02, INV-03).
const demoProducts = [
  {
    sku: 'SKU001',
    name: 'Drinking water pack of 6',
    category: 'Beverages',
    unit: 'pack',
    sellingPrice: '60.00',
    openingB01: 10,
  },
  {
    sku: 'SKU002',
    name: 'Tissue paper',
    category: 'Household',
    unit: 'pack',
    sellingPrice: '35.00',
    openingB01: 5,
  },
  {
    sku: 'SKU003',
    name: 'Laundry detergent',
    category: 'Household',
    unit: 'bag',
    sellingPrice: '120.00',
    openingB01: 0,
  },
];
const REORDER_THRESHOLD = 3;

async function main() {
  for (const store of demoStores) {
    await prisma.store.upsert({
      where: { code: store.code },
      update: { name: store.name },
      create: store,
    });
  }

  for (const supplier of demoSuppliers) {
    await prisma.supplier.upsert({
      where: { code: supplier.code },
      update: supplier,
      create: supplier,
    });
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const user of demoUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, storeId: user.storeId, passwordHash },
      create: { ...user, passwordHash },
    });
  }

  // Products with per-store reorder thresholds, and their opening balances. Re-running the seed
  // resets the balance to the opening quantity and leaves exactly one opening movement per
  // product-store, so the demo data is deterministic however many times it is applied.
  const stores = await prisma.store.findMany({ select: { id: true, code: true } });
  const storeIdByCode = new Map(stores.map((store) => [store.code, store.id]));

  for (const product of demoProducts) {
    const { openingB01, sku, name, category, unit, sellingPrice } = product;
    const row = await prisma.product.upsert({
      where: { sku },
      update: { name, category, unit, sellingPrice },
      create: { sku, name, category, unit, sellingPrice },
    });

    for (const [code, storeId] of storeIdByCode) {
      await prisma.productReorderThreshold.upsert({
        where: { productId_storeId: { productId: row.id, storeId } },
        update: { threshold: REORDER_THRESHOLD },
        create: { productId: row.id, storeId, threshold: REORDER_THRESHOLD },
      });

      const quantity = code === 'B01' ? openingB01 : 0;

      // The ledger is append-only: a re-seed may only lay down the opening movement, never
      // rewind a store that has since posted real movements (RECEIPT/SALE/non-opening ADJUSTMENT).
      // If any such movement exists, the current balance is derived from the ledger by the
      // posting path; the seed leaves both the balance and the opening movement untouched so it
      // can never drift from the ledger. On a fresh (demo-only) database there are none, so the
      // opening balance is (re)written deterministically.
      const postedMovements = await prisma.stockMovement.count({
        where: {
          productId: row.id,
          storeId,
          NOT: { type: 'ADJUSTMENT', sourceType: 'OPENING' },
        },
      });
      if (postedMovements > 0) continue;

      await prisma.stockBalance.upsert({
        where: { productId_storeId: { productId: row.id, storeId } },
        update: { quantity },
        create: { productId: row.id, storeId, quantity },
      });

      // One opening movement per product-store, reset on every seed so the ledger stays in step
      // with the balance. Opening movements have no source document and no actor.
      await prisma.stockMovement.deleteMany({
        where: { productId: row.id, storeId, type: 'ADJUSTMENT', sourceType: 'OPENING' },
      });
      if (quantity !== 0) {
        await prisma.stockMovement.create({
          data: {
            productId: row.id,
            storeId,
            quantityChange: quantity,
            balanceBefore: 0,
            balanceAfter: quantity,
            type: 'ADJUSTMENT',
            sourceType: 'OPENING',
          },
        });
      }
    }
  }

  // PO-DEMO-001 (TOR Section 8): Approved for B01, 20 packs of SKU001 at THB 45.00, nothing
  // received yet. It is only created, never updated, so a re-seed cannot rewind receipts that
  // were posted against it (the ledger is append-only, like the balances above).
  const [b01, sup01, water] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { code: 'B01' } }),
    prisma.supplier.findUniqueOrThrow({ where: { code: 'SUP01' } }),
    prisma.product.findUniqueOrThrow({ where: { sku: 'SKU001' } }),
  ]);
  await prisma.purchaseOrder.upsert({
    where: { number: 'PO-DEMO-001' },
    update: {},
    create: {
      number: 'PO-DEMO-001',
      status: 'APPROVED',
      supplierId: sup01.id,
      storeId: b01.id,
      expectedReceiptDate: new Date('2026-02-01T00:00:00Z'),
      lines: {
        create: [
          {
            productId: water.id,
            sku: water.sku,
            productName: water.name,
            unit: water.unit,
            quantity: 20,
            unitPrice: '45.00',
          },
        ],
      },
    },
  });

  console.log(
    `Seeded ${demoStores.length} stores, ${demoSuppliers.length} suppliers, ` +
      `${demoProducts.length} products with opening balances, PO-DEMO-001 and ${demoUsers.length} demo users ` +
      `(password: "${DEMO_PASSWORD}").`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
