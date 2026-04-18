-- CreateEnum
CREATE TYPE "SkuStatus" AS ENUM ('active', 'discontinued', 'seasonal');

-- CreateEnum
CREATE TYPE "SkuTier" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "Country" AS ENUM ('china', 'malaysia', 'thailand');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('draft', 'ordered', 'in_production', 'on_water', 'at_port', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "ContainerType" AS ENUM ('forty_gp', 'forty_hq');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('domestic_warehouse', 'amazon_warehouse');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('amazon_1p', 'amazon_di', 'domestic');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('wds_export', 'amazon_report');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('wds_inventory', 'wds_monthly_sales', 'amazon_sales', 'amazon_vendor_central', 'amazon_forecast', 'purchase_orders', 'asin_mapping');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ImportErrorType" AS ENUM ('missing_sku', 'invalid_value', 'duplicate', 'format_error', 'unmapped_asin');

-- CreateEnum
CREATE TYPE "OverrideType" AS ENUM ('quantity', 'forecast', 'factory', 'timing', 'container');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('buyer', 'lead_reviewer', 'leadership', 'admin');

-- CreateEnum
CREATE TYPE "ReorderDecision" AS ENUM ('order', 'do_not_order', 'watch');

-- CreateTable
CREATE TABLE "skus" (
    "id" UUID NOT NULL,
    "sku_code" TEXT NOT NULL,
    "asin" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SkuStatus" NOT NULL DEFAULT 'active',
    "category" TEXT,
    "tier" "SkuTier" NOT NULL DEFAULT 'C',
    "vendor_code" TEXT,
    "cbm_per_carton" DECIMAL(65,30),
    "units_per_carton" INTEGER,
    "weight_per_carton_kg" DECIMAL(65,30),
    "moq" INTEGER,
    "unit_cost_usd" DECIMAL(65,30),
    "default_factory_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "lead_time_production_days" INTEGER,
    "lead_time_transit_days" INTEGER,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "factory_id" UUID NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'draft',
    "order_date" DATE,
    "estimated_ship_date" DATE,
    "estimated_arrival_date" DATE,
    "actual_arrival_date" DATE,
    "total_cbm" DECIMAL(65,30),
    "total_cost_usd" DECIMAL(65,30),
    "container_type" "ContainerType",
    "container_count" INTEGER,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_line_items" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost_usd" DECIMAL(65,30),
    "carton_count" INTEGER,
    "line_cbm" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location_type" "LocationType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_snapshots" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "quantity_available" INTEGER NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "import_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_history" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "sale_date" DATE NOT NULL,
    "period_start_date" DATE NOT NULL,
    "period_end_date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "revenue_usd" DECIMAL(65,30),
    "cost_usd" DECIMAL(65,30),
    "source" "DataSource" NOT NULL,
    "import_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amazon_forecasts" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "week_start_date" DATE NOT NULL,
    "week_end_date" DATE NOT NULL,
    "forecast_units" DECIMAL(65,30) NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "import_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amazon_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amazon_metrics" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "oos_rate" DECIMAL(65,30),
    "confirmation_rate" DECIMAL(65,30),
    "net_received_units" INTEGER,
    "open_po_quantity" INTEGER,
    "receive_fill_rate" DECIMAL(65,30),
    "vendor_lead_time_days" INTEGER,
    "unfilled_units" INTEGER,
    "aged_inventory_value" DECIMAL(65,30),
    "aged_inventory_units" INTEGER,
    "sellable_value" DECIMAL(65,30),
    "unsellable_units" INTEGER,
    "import_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "amazon_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_metrics" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "period_weeks" INTEGER NOT NULL,
    "weekly_velocity" DECIMAL(65,30) NOT NULL,
    "total_units" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "blended_velocity" DECIMAL(65,30),
    "seasonally_adjusted_velocity" DECIMAL(65,30),
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reorder_recommendations" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "calculation_date" DATE NOT NULL,
    "decision" "ReorderDecision" NOT NULL,
    "weekly_demand" DECIMAL(65,30) NOT NULL,
    "on_hand_inventory" INTEGER NOT NULL,
    "inbound_inventory" INTEGER NOT NULL,
    "projected_inventory_at_arrival" INTEGER NOT NULL,
    "weeks_of_supply" DECIMAL(65,30) NOT NULL,
    "target_weeks_of_supply" DECIMAL(65,30) NOT NULL,
    "lead_time_days" INTEGER NOT NULL,
    "lead_time_demand" INTEGER NOT NULL,
    "safety_stock" INTEGER NOT NULL,
    "required_inventory_level" INTEGER NOT NULL,
    "reorder_quantity" INTEGER NOT NULL,
    "adjusted_quantity" INTEGER NOT NULL,
    "amazon_forecast_weekly" DECIMAL(65,30),
    "amazon_forecast_order_qty" INTEGER,
    "forecast_variance_pct" DECIMAL(65,30),
    "recommended_factory_id" UUID,
    "recommended_order_by_date" DATE,
    "projected_stockout_date" DATE,
    "container_cbm_impact" DECIMAL(65,30),
    "explanation" TEXT NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reorder_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'buyer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "override_logs" (
    "id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "override_type" "OverrideType" NOT NULL,
    "original_value" TEXT NOT NULL,
    "override_value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "override_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "import_type" "ImportType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0,
    "rows_errored" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "error_summary" TEXT,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_errors" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "field_name" TEXT,
    "error_type" "ImportErrorType" NOT NULL,
    "error_message" TEXT NOT NULL,
    "raw_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku_tier_rules" (
    "id" UUID NOT NULL,
    "tier" "SkuTier" NOT NULL,
    "target_days_of_supply" INTEGER NOT NULL,
    "description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sku_tier_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_stock_rules" (
    "id" UUID NOT NULL,
    "tier" "SkuTier" NOT NULL,
    "safety_stock_days" INTEGER NOT NULL,
    "description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_stock_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_time_rules" (
    "id" UUID NOT NULL,
    "country" "Country" NOT NULL,
    "po_to_production_days" INTEGER NOT NULL,
    "production_days" INTEGER NOT NULL,
    "transit_days" INTEGER NOT NULL,
    "port_processing_days" INTEGER NOT NULL,
    "total_lead_time_days" INTEGER NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_time_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_rules" (
    "id" UUID NOT NULL,
    "container_type" "ContainerType" NOT NULL,
    "max_cbm" DECIMAL(65,30) NOT NULL,
    "max_weight_kg" DECIMAL(65,30) NOT NULL,
    "cost_estimate_usd" DECIMAL(65,30),
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "container_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasonality_factors" (
    "id" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "factor" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "description" TEXT,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasonality_factors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skus_sku_code_key" ON "skus"("sku_code");

-- CreateIndex
CREATE UNIQUE INDEX "skus_asin_key" ON "skus"("asin");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "inventory_snapshots_sku_id_snapshot_date_idx" ON "inventory_snapshots"("sku_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "inventory_snapshots_snapshot_date_idx" ON "inventory_snapshots"("snapshot_date");

-- CreateIndex
CREATE INDEX "sales_history_sku_id_sale_date_idx" ON "sales_history"("sku_id", "sale_date");

-- CreateIndex
CREATE INDEX "sales_history_sale_date_idx" ON "sales_history"("sale_date");

-- CreateIndex
CREATE INDEX "sales_history_channel_idx" ON "sales_history"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "sales_history_sku_id_channel_period_start_date_period_end_d_key" ON "sales_history"("sku_id", "channel", "period_start_date", "period_end_date");

-- CreateIndex
CREATE INDEX "amazon_forecasts_sku_id_snapshot_date_idx" ON "amazon_forecasts"("sku_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "amazon_forecasts_week_start_date_idx" ON "amazon_forecasts"("week_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "amazon_forecasts_sku_id_week_start_date_snapshot_date_key" ON "amazon_forecasts"("sku_id", "week_start_date", "snapshot_date");

-- CreateIndex
CREATE INDEX "amazon_metrics_sku_id_idx" ON "amazon_metrics"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "amazon_metrics_sku_id_snapshot_date_key" ON "amazon_metrics"("sku_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "demand_metrics_sku_id_idx" ON "demand_metrics"("sku_id");

-- CreateIndex
CREATE INDEX "reorder_recommendations_sku_id_is_current_idx" ON "reorder_recommendations"("sku_id", "is_current");

-- CreateIndex
CREATE INDEX "reorder_recommendations_calculation_date_idx" ON "reorder_recommendations"("calculation_date");

-- CreateIndex
CREATE INDEX "reorder_recommendations_decision_idx" ON "reorder_recommendations"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "override_logs_sku_id_idx" ON "override_logs"("sku_id");

-- CreateIndex
CREATE INDEX "override_logs_user_id_idx" ON "override_logs"("user_id");

-- CreateIndex
CREATE INDEX "import_errors_batch_id_idx" ON "import_errors"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sku_tier_rules_tier_key" ON "sku_tier_rules"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "safety_stock_rules_tier_key" ON "safety_stock_rules"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "lead_time_rules_country_key" ON "lead_time_rules"("country");

-- CreateIndex
CREATE UNIQUE INDEX "container_rules_container_type_key" ON "container_rules"("container_type");

-- CreateIndex
CREATE UNIQUE INDEX "seasonality_factors_month_key" ON "seasonality_factors"("month");

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_default_factory_id_fkey" FOREIGN KEY ("default_factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_history" ADD CONSTRAINT "sales_history_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amazon_forecasts" ADD CONSTRAINT "amazon_forecasts_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amazon_forecasts" ADD CONSTRAINT "amazon_forecasts_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amazon_metrics" ADD CONSTRAINT "amazon_metrics_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "amazon_metrics" ADD CONSTRAINT "amazon_metrics_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_metrics" ADD CONSTRAINT "demand_metrics_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_recommendations" ADD CONSTRAINT "reorder_recommendations_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_recommendations" ADD CONSTRAINT "reorder_recommendations_recommended_factory_id_fkey" FOREIGN KEY ("recommended_factory_id") REFERENCES "factories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "override_logs" ADD CONSTRAINT "override_logs_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "override_logs" ADD CONSTRAINT "override_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "override_logs" ADD CONSTRAINT "override_logs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_tier_rules" ADD CONSTRAINT "sku_tier_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_stock_rules" ADD CONSTRAINT "safety_stock_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_time_rules" ADD CONSTRAINT "lead_time_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_rules" ADD CONSTRAINT "container_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasonality_factors" ADD CONSTRAINT "seasonality_factors_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
