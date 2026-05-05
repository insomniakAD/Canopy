-- CreateEnum
CREATE TYPE "ContainerStatus" AS ENUM ('in_transit', 'at_port', 'received', 'cancelled');

-- AlterTable
ALTER TABLE "po_line_items" ADD COLUMN     "container_id" UUID;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "date_closed" DATE,
ADD COLUMN     "factory_ready_date" DATE,
ADD COLUMN     "lot_number" TEXT;

-- CreateTable
CREATE TABLE "containers" (
    "id" UUID NOT NULL,
    "container_number" TEXT NOT NULL,
    "container_type" "ContainerType",
    "status" "ContainerStatus" NOT NULL DEFAULT 'in_transit',
    "estimated_ship_date" DATE,
    "estimated_arrival_date" DATE,
    "actual_arrival_date" DATE,
    "receiving_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "containers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "containers_container_number_key" ON "containers"("container_number");

-- CreateIndex
CREATE INDEX "containers_estimated_arrival_date_idx" ON "containers"("estimated_arrival_date");

-- CreateIndex
CREATE INDEX "containers_status_idx" ON "containers"("status");

-- CreateIndex
CREATE INDEX "po_line_items_container_id_idx" ON "po_line_items"("container_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_lot_number_key" ON "purchase_orders"("lot_number");

-- AddForeignKey
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_container_id_fkey" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

