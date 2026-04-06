// ============================================================================
// Import Processor: Amazon Vendor Central Report
// ============================================================================
// Source: Amazon Vendor Central operational/inventory health report
// Row 0 = metadata, Row 1 = actual headers
//
// Creates:
//   1. Inventory snapshot at "Amazon 1P" (Sellable On Hand Units)
//   2. Amazon metrics record (OOS%, fill rate, aged inventory, etc.)
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow } from "./types";
import { toInt, toNumber } from "./utils";

export async function processAmazonVendorCentral(
  db: PrismaClient,
  rows: SpreadsheetRow[],
  batchId: string,
  snapshotDate: Date
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  // Find Amazon 1P location
  const location = await db.inventoryLocation.findFirst({
    where: { name: "Amazon 1P" },
  });
  if (!location) {
    throw new Error("Amazon 1P location not found. Run seed first.");
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 3; // +3: meta row, header row, then data

    // --- Validate ASIN ---
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

    // --- Look up SKU by ASIN ---
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

    // --- Parse inventory ---
    const sellableUnits = toInt(row["Sellable On Hand Units"]) ?? 0;
    const unsellableUnits = toInt(row["Unsellable On Hand Units"]) ?? 0;

    // Create inventory snapshot
    await db.inventorySnapshot.create({
      data: {
        skuId: sku.id,
        locationId: location.id,
        quantityOnHand: sellableUnits,
        quantityReserved: unsellableUnits,
        quantityAvailable: sellableUnits,
        snapshotDate,
        importBatchId: batchId,
      },
    });

    // --- Parse operational metrics ---
    const oosRate = toNumber(row["Sourceable Product OOS %"]);
    const confirmationRate = toNumber(row["Vendor Confirmation %"]);
    const netReceivedUnits = toInt(row["Net Received Units"]);
    const openPoQuantity = toInt(row["Open Purchase Order Quantity"]);
    const receiveFillRate = toNumber(row["Receive Fill %"]);
    const vendorLeadTimeDays = toInt(row["Overall Vendor Lead Time (days)"]);
    const unfilledUnits = toInt(row["Unfilled Customer Ordered Units"]);
    const agedInventoryValue = toNumber(row["Aged 90+ Days Sellable Inventory"]);
    const agedInventoryUnits = toInt(row["Aged 90+ Days Sellable Units"]);
    const sellableValue = toNumber(row["Sellable On Hand Inventory"]);

    // Upsert Amazon metrics
    await db.amazonMetric.upsert({
      where: {
        unique_amazon_metric: {
          skuId: sku.id,
          snapshotDate,
        },
      },
      update: {
        oosRate,
        confirmationRate,
        netReceivedUnits,
        openPoQuantity,
        receiveFillRate,
        vendorLeadTimeDays,
        unfilledUnits,
        agedInventoryValue,
        agedInventoryUnits,
        sellableValue,
        unsellableUnits,
        importBatchId: batchId,
      },
      create: {
        skuId: sku.id,
        snapshotDate,
        oosRate,
        confirmationRate,
        netReceivedUnits,
        openPoQuantity,
        receiveFillRate,
        vendorLeadTimeDays,
        unfilledUnits,
        agedInventoryValue,
        agedInventoryUnits,
        sellableValue,
        unsellableUnits,
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
