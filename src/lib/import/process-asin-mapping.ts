// ============================================================================
// Import Processor: ASIN Mapping
// ============================================================================
// Links Amazon ASINs to Winsome SKU codes.
// Expected columns: ASIN, ITEM# (or SKU)
//
// Can also be used to update existing mappings.
// If an ASIN is already mapped to a different SKU, it will be remapped
// (the old SKU's ASIN field is cleared, the new SKU gets the ASIN).
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow } from "./types";

export async function processAsinMapping(
  db: PrismaClient,
  rows: SpreadsheetRow[],
  batchId: string
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    // --- Find ASIN column (flexible naming) ---
    const asin = (
      row["ASIN"] ?? row["asin"] ?? row["Asin"]
    );
    const asinStr = asin != null ? String(asin).trim() : "";

    if (!asinStr) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ASIN",
        errorType: "invalid_value",
        message: "ASIN is blank",
      });
      continue;
    }

    // --- Find SKU column (flexible naming) ---
    const skuCode = (
      row["ITEM#"] ?? row["SKU"] ?? row["sku"] ?? row["Item#"] ?? row["item#"] ?? row["Sku"]
    );
    const skuStr = skuCode != null ? String(skuCode).trim() : "";

    if (!skuStr) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ITEM#/SKU",
        errorType: "invalid_value",
        message: "SKU/ITEM# is blank",
      });
      continue;
    }

    // --- Look up SKU ---
    const sku = await db.sku.findUnique({ where: { skuCode: skuStr } });
    if (!sku) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ITEM#/SKU",
        errorType: "missing_sku",
        message: `SKU "${skuStr}" not found in the system. Import WDS Inventory first to create SKUs.`,
        rawValue: skuStr,
      });
      continue;
    }

    // --- Check if ASIN is already mapped to a different SKU ---
    const existingMapping = await db.sku.findUnique({ where: { asin: asinStr } });
    if (existingMapping && existingMapping.id !== sku.id) {
      // Clear old mapping
      await db.sku.update({
        where: { id: existingMapping.id },
        data: { asin: null },
      });
    }

    // --- Set the ASIN on the target SKU ---
    await db.sku.update({
      where: { id: sku.id },
      data: { asin: asinStr },
    });

    imported++;
  }

  return {
    batchId,
    importType: "asin_mapping",
    fileName: "",
    rowCount: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
