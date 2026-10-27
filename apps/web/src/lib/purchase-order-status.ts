import type { PurchaseOrder } from '@erp/contracts';

/** The Thai label of each purchase-order status, shared by the purchasing and receiving screens. */
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrder['status'], string> = {
  DRAFT: 'ฉบับร่าง',
  APPROVED: 'อนุมัติแล้ว',
  PARTIALLY_RECEIVED: 'รับสินค้าบางส่วน',
  COMPLETED: 'รับสินค้าครบแล้ว',
};
