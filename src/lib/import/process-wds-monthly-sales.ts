// ============================================================================
// Import Processor: WDS Monthly Sales (Pivot Format)
// ============================================================================
// The WDS sales export is a pivot table:
//   - Rows = SKUs (ITEM# in first column)
//   - Columns = Months (e.g., "Apr-25", "May-25", "2025-04")
//   - Cell values = Units sold that month
//
// The system "unpivots" this: for each SKU × month combination,
// it creates a sales_history record with the proper period dates.
//
// This gives Canopy raw monthly data to calculate its own 3/6/12-month
// velocity, rather than relying on WDS's pre-blended average.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow } from "./types";
import { parseMonthColumn, toInt, toDateString } from "./utils";

export async function processWdsMonthlySales(
  db: PrismaClient,
  headers: string[],
  rows: SpreadsheetRow[],
  batchId: string
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  // --- Identify which columns are months ---
  // First column should be ITEM# (or similar SKU identifier)
  // Remaining columns that parse as months are sales data
  const skuColumn = headers[0]; // e.g., "ITEM#"
  const monthColumns: { header: string; start: Date; end: Date }[] = [];

  for (let j = 1; j < headers.length; j++) {
    const parsed = parseMonthColumn(headers[j]);
    if (parsed) {
      monthColumns.push({ header: headers[j], ...parsed });
    }
  }

  if (monthColumns.length === 0) {
    errors.push({
      rowNumber: 1,
      fieldName: "headers",
      errorType: "format_error",
      message: `No month columns found. Expected formats like "Apr-25", "2025-04", "Apr 2025". Found headers: ${headers.slice(1, 6).join(", ")}`,
    });
    return {
      batchId,
      importType: "wds_monthly_sales",
      fileName: "",
      rowCount: rows.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsErrored: 1,
      errors,
    };
  }

  // --- Process each row (SKU) × each month column ---
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const itemCode = row[skuColumn] != null ? String(row[skuColumn]).trim() : "";
    if (!itemCode) {
      errors.push({
        rowNumber: rowNum,
        fieldName: skuColumn,
        errorType: "invalid_value",
        message: "SKU code is blank",
      });
      continue;
    }

    // Look up SKU
    const sku = await db.sku.findUnique({ where: { skuCode: itemCode } });
    if (!sku) {
      errors.push({
        rowNumber: rowNum,
        fieldName: skuColumn,
        errorType: "missing_sku",
        message: `SKU "${itemCode}" not found. Import a WDS Inventory file first to create SKUs.`,
        rawValue: itemCode,
      });
      continue;
    }

    // Process each month column
    for (const mc of monthColumns) {
      const rawVal = row[mc.header];
      if (rawVal === null || rawVal === undefined || rawVal === "" || rawVal === "0" || rawVal === 0) {
        continue; // Skip zero or empty months
      }

      const units = toInt(rawVal);
      if (units === null || units < 0) {
        errors.push({
          rowNumber: rowNum,
          fieldName: mc.header,
          errorType: "invalid_value",
          message: `Value "${rawVal}" is not a valid unit count`,
          rawValue: String(rawVal),
        });
        continue;
      }

      // Upsert: if we already have data for this SKU + channel + period, update it
      const periodStart = mc.start;
      const periodEnd = mc.end;

      await db.salesRecord.upsert({
        where: {
          unique_sales_period: {
            skuId: sku.id,
            channel: "domestic",
            periodStartDate: periodStart,
            periodEndDate: periodEnd,
          },
        },
        update: {
          quantity: units,
          importBatchId: batchId,
        },
        create: {
          skuId: sku.id,
          channel: "domestic",
          saleDate: periodStart,
          periodStartDate: periodStart,
          periodEndDate: periodEnd,
          quantity: units,
          source: "wds_export",
          importBatchId: batchId,
        },
      });

      imported++;
    }
  }

  return {
    batchId,
    importType: "wds_monthly_sales",
    fileName: "",
    rowCount: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
