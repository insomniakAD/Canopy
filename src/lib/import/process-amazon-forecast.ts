// ============================================================================
// Import Processor: Amazon Forecast Report
// ============================================================================
// Source: Amazon Vendor Central Forecasting (Mean Forecast)
// Row 0 = metadata, Row 1 = actual headers
//
// Columns: ASIN, Product Title, Brand, then 48 weekly columns:
//   "Week 0 (29 Mar - 4 Apr)" through "Week 47 (21 Feb - 27 Feb)"
//
// Values are decimal forecasted units per week.
//
// Each week column is "unpivoted" into one row in amazon_forecasts table.
// Forecasts are stored alongside Canopy's own calculations so leadership
// can compare the two side by side.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow, AmazonReportMeta } from "./types";
import { parseForecastWeekHeader, toNumber } from "./utils";

export async function processAmazonForecast(
  db: PrismaClient,
  headers: string[],
  rows: SpreadsheetRow[],
  batchId: string,
  snapshotDate: Date,
  meta: AmazonReportMeta
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  // --- Validate: Canopy only uses the Mean forecast ---
  // Amazon offers Mean, P70, P80, etc. as separate exports. Using a P-statistic
  // in place of Mean would silently bias the entire purchasing plan.
  if (meta.forecastStatistic && meta.forecastStatistic.toLowerCase() !== "mean") {
    errors.push({
      rowNumber: 0,
      fieldName: "Forecasting Statistic",
      errorType: "format_error",
      message: `This file is a ${meta.forecastStatistic} forecast. Canopy only uses the Mean forecast. Re-export from Amazon with Forecasting Statistic = Mean.`,
      rawValue: meta.forecastStatistic,
    });
    return {
      batchId,
      importType: "amazon_forecast",
      fileName: "",
      rowCount: rows.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsErrored: 1,
      errors,
    };
  }

  // --- Identify week columns ---
  const weekColumns: {
    header: string;
    weekNumber: number;
    startDate: Date;
    endDate: Date;
  }[] = [];

  for (const h of headers) {
    const parsed = parseForecastWeekHeader(h);
    if (parsed) {
      weekColumns.push({ header: h, ...parsed });
    }
  }

  if (weekColumns.length === 0) {
    errors.push({
      rowNumber: 1,
      fieldName: "headers",
      errorType: "format_error",
      message: `No weekly forecast columns found. Expected format: "Week 0 (29 Mar - 4 Apr)". Found: ${headers.slice(3, 6).join(", ")}`,
    });
    return {
      batchId,
      importType: "amazon_forecast",
      fileName: "",
      rowCount: rows.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsErrored: 1,
      errors,
    };
  }

  // --- Process each ASIN row ---
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 3; // meta row + header row + 1-based

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

    // Look up SKU by ASIN
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

    // --- Process each week column for this ASIN ---
    for (const wc of weekColumns) {
      const rawVal = row[wc.header];
      const forecastUnits = toNumber(rawVal);

      if (forecastUnits === null) continue; // Skip empty cells

      await db.amazonForecast.upsert({
        where: {
          unique_forecast_week: {
            skuId: sku.id,
            weekStartDate: wc.startDate,
            snapshotDate,
          },
        },
        update: {
          weekNumber: wc.weekNumber,
          weekEndDate: wc.endDate,
          forecastUnits,
          importBatchId: batchId,
        },
        create: {
          skuId: sku.id,
          weekNumber: wc.weekNumber,
          weekStartDate: wc.startDate,
          weekEndDate: wc.endDate,
          forecastUnits,
          snapshotDate,
          importBatchId: batchId,
        },
      });

      imported++;
    }
  }

  return {
    batchId,
    importType: "amazon_forecast",
    fileName: "",
    rowCount: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
