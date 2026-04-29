-- AlterEnum
ALTER TYPE "ImportType" ADD VALUE 'wds_monthly_cartons';

-- AlterTable
ALTER TABLE "pending_vendor_transitions" ALTER COLUMN "id" DROP DEFAULT;
