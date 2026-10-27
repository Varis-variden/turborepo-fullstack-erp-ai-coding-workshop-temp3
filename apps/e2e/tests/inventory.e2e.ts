import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

// Demo (ticket #6): a store employee searches stock by SKU, product name, and store and sees
// current quantity, unit, reorder threshold, and low-stock status (quantity at or below
// threshold); the seed shows B01 holding 10 / 5 / 0 for SKU001 / SKU002 / SKU003. SKU001 at B01 is
// the stock other tickets' demos move (adjustments, the receipt against PO-DEMO-001), so this test
// does not pin its quantity: it only needs it to stay above the threshold.
test.describe('stock search', () => {
  test.use({ storageState: storageState('staff') });

  test('a store employee searches B01 stock by SKU and product name and sees quantity, unit, threshold and low-stock status', async ({
    page,
  }) => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'สต็อกสินค้า', level: 1 })).toBeVisible();

    const search = page.getByLabel('ค้นหาด้วยรหัสสินค้าหรือชื่อสินค้า');

    // The seeded B01 opening balances: SKU001 = 10 or more (above threshold 3, not low),
    // SKU002 = 5 (above threshold, not low), SKU003 = 0 (at or below threshold, low stock).
    // Assert the quantity and threshold cells themselves, not the whole row: a row-wide
    // toContainText('10') would also be satisfied by "SKU001" or any other cell.
    const water = page.getByRole('row', { name: /SKU001/ });
    await expect(water).toBeVisible();
    await expect(water.getByRole('cell', { name: 'B01', exact: true })).toBeVisible();
    await expect(water.getByRole('cell', { name: /^\d+$/ }).first()).toBeVisible();
    await expect(water.getByRole('cell', { name: 'pack', exact: true })).toBeVisible();
    await expect(water.getByRole('cell', { name: '3', exact: true })).toBeVisible();
    await expect(water).not.toContainText('สต็อกต่ำ');

    const detergent = page.getByRole('row', { name: /SKU003/ });
    await expect(detergent.getByRole('cell', { name: '0', exact: true })).toBeVisible();
    await expect(detergent).toContainText('สต็อกต่ำ');

    // Searching by SKU narrows to the one matching product.
    await search.fill('SKU002');
    const tissue = page.getByRole('row', { name: /SKU002/ });
    await expect(tissue.getByRole('cell', { name: '5', exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: /SKU001/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /SKU003/ })).toHaveCount(0);

    // Searching by product name works the same way, case-insensitively.
    await search.fill('laundry');
    const byName = page.getByRole('row', { name: /SKU003/ });
    await expect(byName).toBeVisible();
    await expect(byName).toContainText('สต็อกต่ำ');
    await expect(page.getByRole('row', { name: /SKU001/ })).toHaveCount(0);

    // A store employee is scoped to their own store server-side: no cross-store filter is offered.
    await expect(page.getByLabel('สาขา')).toHaveCount(0);
  });
});

// The "and store" axis of the Demo line: only an unassigned user (ADMIN/MANAGER) drives a store
// filter; a store employee is scoped server-side (above). The admin narrows to B01 and B02.
test.describe('stock search by store', () => {
  test.use({ storageState: storageState('admin') });

  test('an unassigned user filters the stock search by store', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'สต็อกสินค้า', level: 1 })).toBeVisible();

    const storeFilter = page.getByLabel('สาขา');
    await expect(storeFilter).toBeVisible();

    // Narrow to B01: SKU001 shows a B01 quantity (10 on a fresh seed; other demos move it).
    await storeFilter.selectOption('B01');
    const waterB01 = page.getByRole('row', { name: /SKU001/ });
    await expect(waterB01).toBeVisible();
    await expect(waterB01.getByRole('cell', { name: 'B01', exact: true })).toBeVisible();
    await expect(waterB01).not.toContainText('สต็อกต่ำ');
    // No B02 rows while scoped to B01.
    await expect(page.getByRole('cell', { name: 'B02', exact: true })).toHaveCount(0);

    // Narrow to B02: SKU001 shows the B02 quantity of 0, low stock against the threshold of 3.
    await storeFilter.selectOption('B02');
    const waterB02 = page.getByRole('row', { name: /SKU001/ });
    await expect(waterB02).toBeVisible();
    await expect(waterB02.getByRole('cell', { name: 'B02', exact: true })).toBeVisible();
    await expect(waterB02.getByRole('cell', { name: '0', exact: true })).toBeVisible();
    await expect(waterB02).toContainText('สต็อกต่ำ');
    await expect(page.getByRole('cell', { name: 'B01', exact: true })).toHaveCount(0);
  });
});
