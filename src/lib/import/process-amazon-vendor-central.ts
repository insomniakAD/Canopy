// ============================================================================
// Import Processor: Amazon Inventory Health
// ============================================================================
// Source: MetricExport_INVENTORY_HEALTH_*.csv from Amazon Vendor Central.
// One row per (ASIN, Region). Regions include 6 US regions plus NATIONAL.
//
// We read only the NATIONAL row per ASIN — Amazon provides this as the
// pre-computed rollup across all regions. Regional rows are ignored.
// All columns other than On-hand_Sellable and On-hand_Unsellable are ignored.
//
// Writes: InventorySnapshot at "Amazon FC".
//
// Semantics: "Amazon FC" = total Amazon fulfillment-center inventory
// (1P + DI combined — Amazon does not distinguish channels in this file).
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow } from "./types";
import { toInt } from "./utils";

const NATIONAL_REGION = "NATIONAL";

export async function processAmazonVendorCentral(
  db: PrismaClient,
  rows: SpreadsheetRow[],
  batchId: string,
  snapshotDate: Date
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  const location = await db.inventoryLocation.findFirst({
    where: { name: "Amazon FC" },
  });
  if (!location) {
    throw new Error('"Amazon FC" inventory location not found. Run seed or migration.');
  }

  // Same ASIN can appear under multiple Vendor_Code values; dedupe by ASIN.
  const processed = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 header row, +1 for 1-based numbering

    const region = row["Region"] != null ? String(row["Region"]).trim() : "";
    if (region !== NATIONAL_REGION) {
      skipped++;
      continue;
    }

    const asin = row["ASIN"] != null ? String(row["ASIN"]).trim() : "";
    if (!asin) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ASIN",
        errorType: "invalid_value",
        message: "ASIN is blank",
      });
      continue;
    }

    if (processed.has(asin)) {
      skipped++;
      continue;
    }
    processed.add(asin);

    const sku = await db.sku.findUnique({ where: { asin } });
    if (!sku) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ASIN",
        errorType: "unmapped_asin",
        message: `ASIN "${asin}" is not linked to any Winsome SKU. Upload an ASIN mapping first.`,
        rawValue: asin,
      });
      continue;
    }

    const sellable = Math.max(0, toInt(row["On-hand_Sellable"]) ?? 0);
    const unsellable = Math.max(0, toInt(row["On-hand_Unsellable"]) ?? 0);

    await db.inventorySnapshot.create({
      data: {
        skuId: sku.id,
        locationId: location.id,
        quantityOnHand: sellable,
        quantityReserved: unsellable,
        quantityAvailable: sellable,
        snapshotDate,
        importBatchId: batchId,
      },
    });

    imported++;
  }

  return {
    batchId,
    importType: "amazon_vendor_central",
    fileName: "",
    rowCount: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
