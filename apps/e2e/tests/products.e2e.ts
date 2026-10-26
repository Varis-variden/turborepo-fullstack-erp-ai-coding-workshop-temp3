import { expect, test, type Page } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('products', () => {
  test.use({ storageState: storageState('admin') });

  async function fillProduct(
    page: Page,
    product: { sku: string; name: string; price: string; threshold: string },
  ) {
    await page.getByLabel('รหัสสินค้า (SKU)').fill(product.sku);
    await page.getByLabel('ชื่อสินค้า').fill(product.name);
    await page.getByLabel('หมวดหมู่').fill('Groceries');
    await page.getByLabel('หน่วยนับ').fill('pack');
    await page.getByLabel('ราคาขาย (บาท)').fill(product.price);
    await page.getByLabel('จุดสั่งซื้อซ้ำ สาขา B01').fill(product.threshold);
  }

  test('an admin creates SKU001, SKU002, SKU003 with a per-store reorder threshold; a duplicate SKU, a negative price, a negative threshold and a non-whole threshold are rejected; a deactivated product leaves the default list but is still found in historical search', async ({
    page,
  }) => {
    const suffix = Date.now(); // this test's rows, nobody else's
    const skus = [`SKU001-${suffix}`, `SKU002-${suffix}`, `SKU003-${suffix}`];
    const submit = page.getByRole('button', { name: 'เพิ่มสินค้า' });

    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'สินค้า', level: 1 })).toBeVisible();

    // Three products are created with name, category, unit, price and a threshold for store B01.
    for (const [index, sku] of skus.entries()) {
      await fillProduct(page, {
        sku,
        name: `Workshop product ${index + 1}`,
        price: `${(index + 1) * 10}.00`,
        threshold: '3',
      });
      await submit.click();
      const row = page.getByRole('row', { name: new RegExp(sku) });
      await expect(row).toBeVisible();
      await expect(row).toContainText(`${(index + 1) * 10}.00`);
      await expect(row).toContainText('B01: 3');
    }

    // The same SKU again is rejected.
    await fillProduct(page, { sku: skus[0], name: 'Again', price: '10.00', threshold: '3' });
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('ถูกใช้งานแล้ว');

    // A negative selling price is rejected.
    await fillProduct(page, { sku: `NEG-${suffix}`, name: 'Negative', price: '-5', threshold: '3' });
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('ราคาขายต้องไม่ติดลบ');

    // A negative reorder threshold is rejected.
    await fillProduct(page, { sku: `NEG-${suffix}`, name: 'Negative', price: '5', threshold: '-1' });
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('จุดสั่งซื้อซ้ำต้องไม่ติดลบ');

    // A quantity that is not a whole number is rejected.
    await fillProduct(page, { sku: `NEG-${suffix}`, name: 'Fraction', price: '5', threshold: '2.5' });
    await submit.click();
    await expect(page.getByRole('alert')).toContainText('จำนวนต้องเป็นจำนวนเต็ม');
    await expect(page.getByRole('row', { name: new RegExp(`NEG-${suffix}`) })).toHaveCount(0);

    // Deactivating SKU002 removes it from the default list...
    await page.getByRole('button', { name: `ปิดใช้งาน ${skus[1]}` }).click();
    await expect(page.getByRole('row', { name: new RegExp(skus[1]) })).toHaveCount(0);
    await expect(page.getByRole('row', { name: new RegExp(skus[0]) })).toBeVisible();

    // ...but historical search still finds it, marked as inactive.
    await page.getByLabel('แสดงสินค้าที่ปิดใช้งาน').check();
    const inactive = page.getByRole('row', { name: new RegExp(skus[1]) });
    await expect(inactive).toBeVisible();
    await expect(inactive).toContainText('ปิดใช้งาน');
  });
});
