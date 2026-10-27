-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'APPROVED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'REJECTED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'PARTIALLY_RECEIVED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "reason" TEXT;
