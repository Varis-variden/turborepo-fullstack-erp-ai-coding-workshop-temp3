import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

// Demo (ticket #11): staff_b01 opens PO-DEMO-001 and sees ordered, previously received, and
// outstanding quantities per line, then receives 8 packs of SKU001 — B01 stock becomes 18,
// outstanding is 12, the order becomes Partially Received, and exactly one receipt and one
// receipt movement exist.
//
// PO-DEMO-001 is the one seeded order, so this test runs once per freshly seeded database (CI
// always has one). B01's stock is not pinned to 18: the stock-adjustment demo also moves SKU001
// at B01 and the two files run in parallel, so the test asserts the stock rose by at least the 8
// received. The exact 10 -> 18, the single receipt and the single movement are proved by the
// AC-01 integration test, which owns its rows.
test.describe('goods receipt', () => {
  test.use({ storageState: storageState('staff') });

  test('staff_b01 opens PO-DEMO-001, sees ordered, received and outstanding quantities, then receives 8 packs of SKU001 and sees 12 outstanding and Partially Received', async ({
    page,
  }) => {
    const stockOfWater = async () => {
      await page.goto('/inventory');
      const row = page.getByRole('row', { name: /SKU001/ });
      await expect(row).toBeVisible();
      return Number(await row.getByRole('cell').nth(3).innerText());
    };
    const stockBefore = await stockOfWater();

    await page.goto('/goods-receipts');
    await expect(page.getByRole('heading', { name: 'รับสินค้า', level: 1 })).toBeVisible();

    // Ordered 20, nothing received yet, 20 outstanding.
    const order = page.getByRole('region', { name: 'PO-DEMO-001' });
    await expect(order).toBeVisible();
    await expect(order).toContainText('อนุมัติแล้ว');
    const water = order.getByRole('row', { name: /SKU001/ });
    await expect(water.getByRole('cell', { name: '20', exact: true })).toHaveCount(2);
    await expect(water.getByRole('cell', { name: '0', exact: true })).toBeVisible();

    // Receive 8 of the 20.
    await water.getByLabel('จำนวนที่รับครั้งนี้ SKU001').fill('8');
    await order.getByRole('button', { name: 'ยืนยันการรับสินค้า' }).click();

    // One receipt with a GR- number, and the order is now Partially Received: 8 received, 12 left.
    await expect(order.getByRole('status')).toHaveText(/บันทึกใบรับสินค้า GR-\d{3,} สำเร็จ/);
    await expect(order).toContainText('รับสินค้าบางส่วน');
    await expect(water.getByRole('cell', { name: '8', exact: true })).toBeVisible();
    await expect(water.getByRole('cell', { name: '12', exact: true })).toBeVisible();

    // A reload shows the same: the 8 was counted once.
    await page.reload();
    const reloaded = page
      .getByRole('region', { name: 'PO-DEMO-001' })
      .getByRole('row', { name: /SKU001/ });
    await expect(reloaded.getByRole('cell', { name: '8', exact: true })).toBeVisible();
    await expect(reloaded.getByRole('cell', { name: '12', exact: true })).toBeVisible();

    // B01's stock rose by the 8 received.
    expect(await stockOfWater()).toBeGreaterThanOrEqual(stockBefore + 8);
  });
});
