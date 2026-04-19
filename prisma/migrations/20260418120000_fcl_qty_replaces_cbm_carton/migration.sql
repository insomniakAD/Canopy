-- Replace CBM/CARTON + UNITS/CARTON with direct FCL quantities per SKU.
-- Rationale: each SKU ships 1 unit/carton, factories confirm container type
-- after PO placement, so per-SKU FCL quantities from factory quotes are a
-- better input than derived CBM math.

-- 1. Sku table: drop CBM/UNITS per carton, add FCL quantities.
ALTER TABLE "skus"
  DROP COLUMN IF EXISTS "cbm_per_carton",
  DROP COLUMN IF EXISTS "units_per_carton",
  DROP COLUMN IF EXISTS "weight_per_carton_kg",
  ADD COLUMN "fcl_qty_40gp" INTEGER,
  ADD COLUMN "fcl_qty_40hq" INTEGER;

-- 2. Pending vendor transitions: same replacement.
ALTER TABLE "pending_vendor_transitions"
  DROP COLUMN IF EXISTS "new_cbm_carton",
  DROP COLUMN IF EXISTS "new_units_carton",
  ADD COLUMN "new_fcl_qty_40gp" INTEGER,
  ADD COLUMN "new_fcl_qty_40hq" INTEGER;

-- 3. Reorder recommendations: rename container_cbm_impact to fcl_fraction_hq.
ALTER TABLE "reorder_recommendations"
  DROP COLUMN IF EXISTS "container_cbm_impact",
  ADD COLUMN "fcl_fraction_hq" DECIMAL(65, 30);
