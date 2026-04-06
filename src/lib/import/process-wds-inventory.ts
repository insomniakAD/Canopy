// ============================================================================
// Import Processor: WDS Inventory Export
// ============================================================================
// Expected columns: ITEM#, SALES DESCRIPTION, VENDOR#, ONHAND, IMPORT ON ORDER
//
// What it does:
//   1. For each row, looks up SKU by ITEM#
//   2. If SKU doesn't exist, auto-creates it (status=active, tier=C)
//   3. Updates SALES DESCRIPTION and VENDOR# on the SKU
//   4. Creates an inventory snapshot for Woodinville Warehouse
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow } from "./types";
import { toInt } from "./utils";

export async function processWdsInventory(
  db: PrismaClient,
  rows: SpreadsheetRow[],
  batchId: string,
  snapshotDate: Date
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  // Find Woodinville location
  const location = await db.inventoryLocation.findFirst({
    where: { name: "Woodinville Warehouse" },
  });
  if (!location) {
    throw new Error("Woodinville Warehouse location not found. Run seed first.");
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2 because row 1 is header

    // --- Validate ITEM# ---
    const itemCode = row["ITEM#"] != null ? String(row["ITEM#"]).trim() : "";
    if (!itemCode) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ITEM#",
        errorType: "invalid_value",
        message: "ITEM# is blank",
      });
      continue;
    }

    // --- Validate ONHAND ---
    const onHand = toInt(row["ONHAND"]);
    if (onHand === null) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ONHAND",
        errorType: "invalid_value",
        message: `ONHAND is not a valid number`,
        rawValue: String(row["ONHAND"] ?? ""),
      });
      continue;
    }

    // --- Find or create SKU ---
    let sku = await db.sku.findUnique({ where: { skuCode: itemCode } });

    if (!sku) {
      // Auto-create new SKU from WDS data
      const name = row["SALES DESCRIPTION"]
        ? String(row["SALES DESCRIPTION"]).trim()
        : `SKU ${itemCode}`;
      const vendorCode = row["VENDOR#"]
        ? String(row["VENDOR#"]).trim()
        : null;

      sku = await db.sku.create({
        data: {
          skuCode: itemCode,
          name,
          vendorCode,
          status: "active",
          tier: "C",
        },
      });
    } else {
      // Update name and vendor code if provided
      const updates: Record<string, string> = {};
      if (row["SALES DESCRIPTION"]) {
        updates.name = String(row["SALES DESCRIPTION"]).trim();
      }
      if (row["VENDOR#"]) {
        updates.vendorCode = String(row["VENDOR#"]).trim();
      }
      if (Object.keys(updates).length > 0) {
        await db.sku.update({ where: { id: sku.id }, data: updates });
      }
    }

    // --- Create inventory snapshot ---
    await db.inventorySnapshot.create({
      data: {
        skuId: sku.id,
        locationId: location.id,
        quantityOnHand: onHand,
        quantityReserved: 0,
        quantityAvailable: onHand,
        snapshotDate,
        importBatchId: batchId,
      },
    });

    imported++;
  }

  return {
    batchId,
    importType: "wds_inventory",
    fileName: "",
    rowCount: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
