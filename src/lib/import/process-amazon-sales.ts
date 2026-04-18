// ============================================================================
// Import Processor: Amazon Sales Report
// ============================================================================
// Source: Amazon Vendor Central Sales Diagnostic
// Row 0 = metadata (filters, date range), Row 1 = actual headers
//
// Key columns: ASIN, Product Title, Brand, Ordered Revenue, Ordered Units,
//   Shipped Revenue, Shipped COGS, Shipped Units, Customer Returns
//
// "Shipped Units" is the true demand signal — actual consumer deliveries.
// Date range is parsed from the metadata row.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow, AmazonReportMeta } from "./types";
import { toInt, toNumber } from "./utils";

export async function processAmazonSales(
  db: PrismaClient,
  rows: SpreadsheetRow[],
  batchId: string,
  meta: AmazonReportMeta
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  // Validate we have a date range
  if (!meta.reportDateRange) {
    errors.push({
      rowNumber: 0,
      fieldName: "metadata",
      errorType: "format_error",
      message: "Could not find date range in report metadata. Expected 'Viewing Range=[start - end]' in row 1.",
    });
    return {
      batchId,
      importType: "amazon_sales",
      fileName: "",
      rowCount: rows.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsErrored: 1,
      errors,
    };
  }

  const periodStart = meta.reportDateRange.start;
  const periodEnd = meta.reportDateRange.end;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 3; // +3 because row 0=meta, row 1=header, data starts row 2

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

    // --- Parse Shipped Units (the demand signal) ---
    const shippedUnits = toInt(row["Shipped Units"]);
    if (shippedUnits === null || shippedUnits < 0) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "Shipped Units",
        errorType: "invalid_value",
        message: `Shipped Units "${row["Shipped Units"]}" is not a valid number`,
        rawValue: String(row["Shipped Units"] ?? ""),
      });
      continue;
    }

    // Parse optional financial fields
    const shippedRevenue = toNumber(row["Shipped Revenue"]);
    const shippedCogs = toNumber(row["Shipped COGS"]);

    // --- Upsert sales record ---
    await db.salesRecord.upsert({
      where: {
        unique_sales_period: {
          skuId: sku.id,
          channel: "amazon_1p",
          periodStartDate: periodStart,
          periodEndDate: periodEnd,
        },
      },
      update: {
        quantity: shippedUnits,
        revenueUsd: shippedRevenue,
        costUsd: shippedCogs,
        importBatchId: batchId,
      },
      create: {
        skuId: sku.id,
        channel: "amazon_1p",
        saleDate: periodStart,
        periodStartDate: periodStart,
        periodEndDate: periodEnd,
        quantity: shippedUnits,
        revenueUsd: shippedRevenue,
        costUsd: shippedCogs,
        source: "amazon_report",
        importBatchId: batchId,
      },
    });

    imported++;
  }

  return {
    batchId,
    importType: "amazon_sales",
    fileName: "",
    rowCount: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
