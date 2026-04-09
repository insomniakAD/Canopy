-- AlterEnum
ALTER TYPE "ImportType" ADD VALUE 'di_orders';

-- AlterEnum
ALTER TYPE "SalesChannel" ADD VALUE 'amazon_df';

-- AlterEnum
ALTER TYPE "SkuTier" ADD VALUE 'LP';

-- AlterTable
ALTER TABLE "demand_metrics" ADD COLUMN     "channel_amazon_1p_velocity" DECIMAL(65,30),
ADD COLUMN     "channel_amazon_df_velocity" DECIMAL(65,30),
ADD COLUMN     "channel_amazon_di_velocity" DECIMAL(65,30),
ADD COLUMN     "channel_domestic_velocity" DECIMAL(65,30),
ADD COLUMN     "weekly_revenue_usd" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "reorder_recommendations" ADD COLUMN     "amazon_daily_velocity" DECIMAL(65,30),
ADD COLUMN     "amazon_doi" DECIMAL(65,30),
ADD COLUMN     "amazon_on_hand" INTEGER,
ADD COLUMN     "amazon_target_doi" INTEGER,
ADD COLUMN     "di_health_status" TEXT,
ADD COLUMN     "di_share_pct" DECIMAL(65,30),
ADD COLUMN     "woodinville_exposure" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "sku_tier_rules" ADD COLUMN     "amazon_target_doi" INTEGER;

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "auto_tier" "SkuTier",
ADD COLUMN     "average_selling_price" DECIMAL(65,30),
ADD COLUMN     "is_di_eligible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "di_orders" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "amazon_po_number" TEXT,
    "quantity" INTEGER NOT NULL,
    "order_date" DATE NOT NULL,
    "estimated_arrival_date" DATE,
    "actual_arrival_date" DATE,
    "status" "PoStatus" NOT NULL DEFAULT 'ordered',
    "factory_id" UUID,
    "import_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "di_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tier_snapshots" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "run_label" TEXT NOT NULL,
    "tier" "SkuTier" NOT NULL,
    "trailing_revenue_usd" DECIMAL(65,30) NOT NULL,
    "revenue_rank_pct" DECIMAL(65,30) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculated_by_id" UUID,

    CONSTRAINT "tier_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "di_orders_sku_id_order_date_idx" ON "di_orders"("sku_id", "order_date");

-- CreateIndex
CREATE INDEX "di_orders_status_idx" ON "di_orders"("status");

-- CreateIndex
CREATE INDEX "tier_snapshots_run_label_idx" ON "tier_snapshots"("run_label");

-- CreateIndex
CREATE INDEX "tier_snapshots_sku_id_is_active_idx" ON "tier_snapshots"("sku_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "di_orders" ADD CONSTRAINT "di_orders_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "di_orders" ADD CONSTRAINT "di_orders_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "di_orders" ADD CONSTRAINT "di_orders_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tier_snapshots" ADD CONSTRAINT "tier_snapshots_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
