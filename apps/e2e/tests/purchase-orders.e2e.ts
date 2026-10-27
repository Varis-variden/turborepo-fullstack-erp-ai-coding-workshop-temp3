import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

// Demo (ticket #9): a purchasing officer creates a draft purchase order with a supplier,
// destination store, expected receipt date, and at least one product line; ordered quantities
// must be positive whole numbers, purchase unit prices non-negative, and a duplicate SKU within
// one order is rejected; each line stores a point-in-time snapshot of the product.
test.describe('purchase-order drafting', () => {
  test.use({ storageState: storageState('buyer') });

  test('a purchasing officer creates a draft purchase order, sees the rules reject bad quantities, prices and duplicate SKUs, and sees the product snapshot on the line', async ({
    page,
  }) => {
    // This test's order is the one with this quantity; other tests' orders are not touched.
    const quantity = 1000 + (Date.now() % 9000);

    await page.goto('/purchase-orders');
    await expect(page.getByRole('heading', { name: 'ใบสั่งซื้อ', level: 1 })).toBeVisible();

    await expect(page.getByRole('option', { name: /SUP01/ })).toBeAttached();
    await expect(page.getByRole('option', { name: /SKU001/ }).first()).toBeAttached();
    await page.getByLabel('ผู้จัดจำหน่าย').selectOption('SUP01');
    await page.getByLabel('สาขาปลายทาง').selectOption('B01');
    await page.getByLabel('วันที่คาดว่าจะได้รับสินค้า').fill('2026-02-01');

    const sku1 = page.getByLabel('สินค้า (SKU) รายการที่ 1');
    const qty1 = page.getByLabel('จำนวนที่สั่ง รายการที่ 1');
    const price1 = page.getByLabel('ราคาซื้อต่อหน่วย (บาท) รายการที่ 1');
    const submit = page.getByRole('button', { name: 'สร้างใบสั่งซื้อฉบับร่าง' });

    // A quantity that is not a positive whole number is rejected.
    await sku1.selectOption('SKU001');
    await qty1.fill('0');
    await price1.fill('45');
    await submit.click();
    await expect(page.getByRole('alert')).toContainText(
      'จำนวนที่สั่งต้องเป็นจำนวนเต็มที่มากกว่า 0',
    );

    await qty1.fill('1.5');
    await submit.click();
    await expect(page.getByRole('alert')).toContainText(
      'จำนวนที่สั่งต้องเป็นจำนวนเต็มที่มากกว่า 0',
    );

    // A negative purchase unit price is rejected.
    await qty1.fill(String(quantity));
    await price1.fill('-1');
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('ราคาซื้อต่อหน่วยต้องไม่ติดลบ');

    // A duplicate SKU within one order is rejected.
    await price1.fill('45');
    await page.getByRole('button', { name: 'เพิ่มรายการสินค้า' }).click();
    await page.getByLabel('สินค้า (SKU) รายการที่ 2').selectOption('SKU001');
    await page.getByLabel('จำนวนที่สั่ง รายการที่ 2').fill('1');
    await page.getByLabel('ราคาซื้อต่อหน่วย (บาท) รายการที่ 2').fill('45');
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('ซ้ำในใบสั่งซื้อเดียวกัน');

    // Change the second line to a different SKU: the draft is created with a PO- number.
    await page.getByLabel('สินค้า (SKU) รายการที่ 2').selectOption('SKU002');
    await page.getByLabel('ราคาซื้อต่อหน่วย (บาท) รายการที่ 2').fill('0');
    await submit.click();

    const order = page.getByRole('region').filter({
      has: page.getByRole('cell', { name: String(quantity), exact: true }),
    });
    await expect(order).toBeVisible();
    await expect(order.getByRole('heading', { level: 2 })).toHaveText(/^PO-\d{3,}$/);
    await expect(order).toContainText('ฉบับร่าง');
    await expect(order).toContainText('SupplyOne Co Ltd');
    await expect(order).toContainText('Central Store');
    await expect(order).toContainText('2026-02-01');

    // Each line carries the product snapshot: SKU, name, unit and the purchase price.
    const water = order.getByRole('row', { name: /SKU001/ });
    await expect(water.getByRole('cell', { name: 'Drinking water pack of 6' })).toBeVisible();
    await expect(water.getByRole('cell', { name: 'pack', exact: true })).toBeVisible();
    await expect(water.getByRole('cell', { name: '45.00', exact: true })).toBeVisible();
    const tissue = order.getByRole('row', { name: /SKU002/ });
    await expect(tissue.getByRole('cell', { name: 'Tissue paper' })).toBeVisible();
    await expect(tissue.getByRole('cell', { name: '0.00', exact: true })).toBeVisible();
  });
});

test.describe('purchase-order access', () => {
  test.use({ storageState: storageState('staff') });

  test('a store employee is not offered purchase orders', async ({ page }) => {
    await page.goto('/purchase-orders');
    await expect(page.getByText('บัญชีนี้ไม่มีสิทธิ์ดูใบสั่งซื้อ')).toBeVisible();
    await expect(page.getByRole('button', { name: 'สร้างใบสั่งซื้อฉบับร่าง' })).toHaveCount(0);
  });
});
