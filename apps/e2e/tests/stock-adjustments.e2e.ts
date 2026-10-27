import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

// Demo (ticket #8): a manager increases or decreases stock for a product and store with a
// mandatory reason; the change is recorded in the audit log; a reduction greater than the
// available balance is rejected (and that rejection is itself audited).
test.describe('manager stock adjustment', () => {
  test.use({ storageState: storageState('manager') });

  test('a manager adjusts stock with a mandatory reason, sees it in the audit log, and a reduction greater than the available balance is rejected', async ({
    page,
  }) => {
    // This run's own rows, found by their unique reasons.
    const increaseReason = `recount-${Date.now()}`;
    const rejectReason = `over-reduce-${Date.now()}`;

    await page.goto('/stock-adjustments');
    await expect(page.getByRole('heading', { name: 'ปรับสต็อก', level: 1 })).toBeVisible();

    // Increase SKU001 at B01 by 2 with a mandatory reason.
    await page.getByLabel('รหัสสินค้า (SKU)').fill('SKU001');
    await page.getByLabel('สาขา').selectOption('B01');
    await page.getByLabel('จำนวนที่ปรับ (+ เพิ่ม / - ลด)').fill('2');
    await page.getByLabel('เหตุผล').fill(increaseReason);
    await page.getByRole('button', { name: 'บันทึกการปรับสต็อก' }).click();

    // The adjustment succeeds and the new balance is shown.
    await expect(page.getByRole('status')).toContainText('SKU001');

    // It appears in the audit log as a successful entry for B01.
    const postedRow = page.getByRole('row', { name: new RegExp(increaseReason) });
    await expect(postedRow).toBeVisible();
    await expect(postedRow.getByRole('cell', { name: 'B01', exact: true })).toBeVisible();
    await expect(postedRow).toContainText('สำเร็จ');

    // A reduction greater than the available balance is rejected.
    await page.getByLabel('รหัสสินค้า (SKU)').fill('SKU001');
    await page.getByLabel('สาขา').selectOption('B01');
    await page.getByLabel('จำนวนที่ปรับ (+ เพิ่ม / - ลด)').fill('-999999');
    await page.getByLabel('เหตุผล').fill(rejectReason);
    await page.getByRole('button', { name: 'บันทึกการปรับสต็อก' }).click();

    await expect(page.getByRole('alert')).toContainText('สต็อกสินค้าไม่เพียงพอ');

    // The rejected attempt is itself audited.
    const rejectedRow = page.getByRole('row', { name: new RegExp(rejectReason) });
    await expect(rejectedRow).toBeVisible();
    await expect(rejectedRow).toContainText('ถูกปฏิเสธ');
  });
});
