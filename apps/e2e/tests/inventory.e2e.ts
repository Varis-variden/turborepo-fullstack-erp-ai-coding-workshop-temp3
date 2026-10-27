import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

// Demo (ticket #6): a store employee searches stock by SKU, product name, and store and sees
// current quantity, unit, reorder threshold, and low-stock status (quantity at or below
// threshold); the seed shows B01 holding 10 / 5 / 0 for SKU001 / SKU002 / SKU003.
test.describe('stock search', () => {
  test.use({ storageState: storageState('staff') });

  test('a store employee searches B01 stock by SKU and product name and sees quantity, unit, threshold and low-stock status', async ({
    page,
  }) => {
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'สต็อกสินค้า', level: 1 })).toBeVisible();

    const search = page.getByLabel('ค้นหาด้วยรหัสสินค้าหรือชื่อสินค้า');

    // The seeded B01 opening balances: SKU001 = 10 (above threshold 3, not low),
    // SKU002 = 5 (above threshold, not low), SKU003 = 0 (at or below threshold, low stock).
    const water = page.getByRole('row', { name: /SKU001/ });
    await expect(water).toBeVisible();
    await expect(water).toContainText('B01');
    await expect(water).toContainText('10');
    await expect(water).toContainText('pack');
    await expect(water).toContainText('3');
    await expect(water).not.toContainText('สต็อกต่ำ');

    const detergent = page.getByRole('row', { name: /SKU003/ });
    await expect(detergent).toContainText('0');
    await expect(detergent).toContainText('สต็อกต่ำ');

    // Searching by SKU narrows to the one matching product.
    await search.fill('SKU002');
    await expect(page.getByRole('row', { name: /SKU002/ })).toContainText('5');
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
