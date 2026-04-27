-- ============================================================================
-- WDS Active Items + SKU cost field restructure
-- ============================================================================
-- 1. SkuStatus enum: drop `seasonal` (unused), add `end_of_life` and `new_item`.
--    Recreated rather than altered in place because Postgres cannot remove
--    an enum value without recreating the type.
-- 2. ImportType enum: add `wds_active_items` (matches existing add-value pattern).
-- 3. Sku table: rename unit_cost_usd → factory_cost; add base_price,
--    replacement_cost, origin_country, is_assembly.
-- ============================================================================

-- 1. SkuStatus enum recreation
ALTER TYPE "SkuStatus" RENAME TO "SkuStatus_old";

CREATE TYPE "SkuStatus" AS ENUM ('active', 'discontinued', 'end_of_life', 'new_item');

ALTER TABLE "skus"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "SkuStatus" USING "status"::text::"SkuStatus",
  ALTER COLUMN "status" SET DEFAULT 'active';

DROP TYPE "SkuStatus_old";

-- 2. ImportType: add new value
ALTER TYPE "ImportType" ADD VALUE IF NOT EXISTS 'wds_active_items';

-- 3. Sku table changes
ALTER TABLE "skus" RENAME COLUMN "unit_cost_usd" TO "factory_cost";

ALTER TABLE "skus"
  ADD COLUMN "base_price" DECIMAL(65, 30),
  ADD COLUMN "replacement_cost" DECIMAL(65, 30),
  ADD COLUMN "origin_country" "Country",
  ADD COLUMN "is_assembly" BOOLEAN NOT NULL DEFAULT false;
