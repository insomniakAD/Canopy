-- Item Update importer + Vendor Transitions
-- 1. Country enum: add indonesia
-- 2. Factory: country optional, vendor_code (unique)
-- 3. ImportType enum: add item_update
-- 4. New enum VendorTransitionStatus + pending_vendor_transitions table

ALTER TYPE "Country" ADD VALUE IF NOT EXISTS 'indonesia';

ALTER TYPE "ImportType" ADD VALUE IF NOT EXISTS 'item_update';

ALTER TABLE "factories" ALTER COLUMN "country" DROP NOT NULL;

ALTER TABLE "factories" ADD COLUMN "vendor_code" TEXT;
CREATE UNIQUE INDEX "factories_vendor_code_key" ON "factories"("vendor_code");

CREATE TYPE "VendorTransitionStatus" AS ENUM ('pending', 'consumed', 'cancelled');

CREATE TABLE "pending_vendor_transitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku_id" UUID NOT NULL,
    "new_vendor_code" TEXT NOT NULL,
    "from_factory_id" UUID,
    "to_factory_id" UUID,
    "new_unit_cost" DECIMAL(65,30),
    "new_moq" INTEGER,
    "new_cbm_carton" DECIMAL(65,30),
    "new_units_carton" INTEGER,
    "reason" TEXT,
    "expected_first_po_date" DATE,
    "status" "VendorTransitionStatus" NOT NULL DEFAULT 'pending',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_vendor_transitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pending_vendor_transitions_sku_id_status_idx" ON "pending_vendor_transitions"("sku_id", "status");
CREATE INDEX "pending_vendor_transitions_status_idx" ON "pending_vendor_transitions"("status");

ALTER TABLE "pending_vendor_transitions" ADD CONSTRAINT "pending_vendor_transitions_sku_id_fkey"
    FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pending_vendor_transitions" ADD CONSTRAINT "pending_vendor_transitions_from_factory_id_fkey"
    FOREIGN KEY ("from_factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pending_vendor_transitions" ADD CONSTRAINT "pending_vendor_transitions_to_factory_id_fkey"
    FOREIGN KEY ("to_factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
