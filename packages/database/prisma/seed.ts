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
const DEMO_PASSWORD = 'password';

async function main() {
  for (const store of demoStores) {
    await prisma.store.upsert({
      where: { code: store.code },
      update: { name: store.name },
      create: store,
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
  console.log(
    `Seeded ${demoStores.length} stores and ${demoUsers.length} demo users (password: "${DEMO_PASSWORD}").`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
