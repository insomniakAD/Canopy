-- CreateEnum
CREATE TYPE "PoReceivingLocation" AS ENUM ('warehouse', 'direct_import');

-- AlterTable
ALTER TABLE "inventory_snapshots" ADD COLUMN     "avail_dsfeed" INTEGER,
ADD COLUMN     "avail_edi" INTEGER;

-- AlterTable
ALTER TABLE "po_line_items" ADD COLUMN     "date_line_closed" DATE,
ADD COLUMN     "date_needed" DATE,
ADD COLUMN     "date_promise" DATE,
ADD COLUMN     "dwg" TEXT,
ADD COLUMN     "fob" TEXT,
ADD COLUMN     "line_num" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "quantity_cancelled" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantity_remaining" INTEGER,
ADD COLUMN     "rec_loc" "PoReceivingLocation" NOT NULL DEFAULT 'warehouse';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "first_receive_date" DATE,
ADD COLUMN     "last_receive_date" DATE,
ADD COLUMN     "vendor_name" TEXT,
ADD COLUMN     "vendor_num" TEXT;
