// ============================================================================
// Processor Registry
// ============================================================================
// Maps ImportType → staging contract. Types in this map use the two-phase
// (stage → commit) flow. Types NOT in this map fall through to the legacy
// direct-commit path in the API route.
//
// We migrate processors into this map incrementally across Commits 2a/2b
// so the cutover is reviewable one importer at a time.
// ============================================================================

import type { ImportType } from "@/generated/prisma/client";
import type { ProcessorStagingContract } from "./types";
import { wdsActiveItemsStaging } from "../processors/wds-active-items-staging";
import { wdsMonthlySalesStaging, wdsMonthlyCartonsStaging } from "../processors/wds-monthly-sales-staging";
import { amazonSalesStaging } from "../processors/amazon-sales-staging";
import { amazonVendorCentralStaging } from "../processors/amazon-vendor-central-staging";
import { diOrdersStaging } from "../processors/di-orders-staging";
import { asinMappingStaging } from "../processors/asin-mapping-staging";
import { amazonForecastStaging } from "../processors/amazon-forecast-staging";
import { wdsInventoryStaging } from "../processors/wds-inventory-staging";
import { purchaseOrdersStaging } from "../processors/purchase-orders-staging";
import { kitCompositionStaging } from "../processors/kit-composition-staging";
import { itemUpdateStaging } from "../processors/item-update-staging";
import { parthistDailyStaging } from "../processors/parthist-daily-staging";

/**
 * All import types go through staging (two-phase preview → commit).
 */
export const STAGING_PROCESSORS: Partial<
  Record<ImportType, ProcessorStagingContract<unknown>>
> = {
  wds_active_items:       wdsActiveItemsStaging        as ProcessorStagingContract<unknown>,
  wds_monthly_sales:      wdsMonthlySalesStaging       as ProcessorStagingContract<unknown>,
  wds_monthly_cartons:    wdsMonthlyCartonsStaging     as ProcessorStagingContract<unknown>,
  amazon_sales:           amazonSalesStaging           as ProcessorStagingContract<unknown>,
  amazon_vendor_central:  amazonVendorCentralStaging   as ProcessorStagingContract<unknown>,
  di_orders:              diOrdersStaging              as ProcessorStagingContract<unknown>,
  asin_mapping:           asinMappingStaging           as ProcessorStagingContract<unknown>,
  amazon_forecast:        amazonForecastStaging        as ProcessorStagingContract<unknown>,
  wds_inventory:          wdsInventoryStaging          as ProcessorStagingContract<unknown>,
  purchase_orders:        purchaseOrdersStaging        as ProcessorStagingContract<unknown>,
  kit_composition:        kitCompositionStaging        as ProcessorStagingContract<unknown>,
  item_update:            itemUpdateStaging            as ProcessorStagingContract<unknown>,
  wds_parthist_daily:     parthistDailyStaging          as ProcessorStagingContract<unknown>,
};

/** Returns true if this import type uses the two-phase flow. */
export function usesStaging(importType: ImportType): boolean {
  return importType in STAGING_PROCESSORS;
}

/** Fetch the contract for an import type. Throws if not registered. */
export function getProcessor(importType: ImportType): ProcessorStagingContract<unknown> {
  const contract = STAGING_PROCESSORS[importType];
  if (!contract) {
    throw new Error(
      `Import type "${importType}" is not wired for staging yet. ` +
        `Use the legacy direct-commit path or register a staging contract.`
    );
  }
  return contract;
}
