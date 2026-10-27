import type { PurchaseOrder } from '@erp/contracts';

/** The Thai label of each purchase-order status, shared by the purchasing and receiving screens. */
export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrder['status'], string> = {
  DRAFT: 'ฉบับร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกปฏิเสธ',
  CANCELLED: 'ยกเลิกแล้ว',
  PARTIALLY_RECEIVED: 'รับสินค้าบางส่วน',
  COMPLETED: 'รับสินค้าครบแล้ว',
};
