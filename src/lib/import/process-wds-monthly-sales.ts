// ============================================================================
// Import Processor: WDS Monthly Sales (citmperiod_papp.csv pivot)
// ============================================================================
// The WDS monthly sales export is a pivot:
//   - Rows = SKUs (ITEM# in one column)
//   - Columns = 13 recent months (headers like "Apr-25", "2025-04")
//   - Cell values = units sold that month
//   - A per-row "TYPE" column flags each SKU as:
//       K = Kit Parent (virtual sellable listing)
//       c = Kit Component (child of at least one Kit Parent)
//       A = Assembly — internal manufacturing item, DISREGARD
//       (blank / anything else) = Standalone
//
// What this processor does:
//   1. Finds the SKU, TYPE, and month columns dynamically from the headers.
//   2. Skips any row whose TYPE is "A" (assembly — never treated as salable).
//   3. Upserts one sales_history record per (SKU × month) for Kit Parent,
//      Kit Component, and Standalone rows. Channel = "domestic".
//   4. For Kit Parents: the cell value is ALREADY the number of kits sold
//      (WDS invoices 1 unit per kit); we store it verbatim — do NOT multiply
//      by qty_per_kit. Kit-implied child demand is derived later in the
//      calculation engine using kit_components.
//   5. Roles (isKitParent / isKitComponent) are NOT changed here — those are
//      owned by the kit_composition importer (kititems.csv is source of truth).
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow } from "./types";
import { parseMonthColumn, toInt } from "./utils";

export async function processWdsMonthlySales(
  db: PrismaClient,
  headers: string[],
  rows: SpreadsheetRow[],
  batchId: string
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  // ---- Identify columns ----
  const skuHeader = headers.find((h) => /^ITEM\s*#?$|^SKU$|^ITEM\s*NO/i.test(h)) ?? headers[0];
  const typeHeader = headers.find((h) => /^TYPE$|^FLAG$|^KIT$|^KIND$/i.test(h)) ?? null;

  const monthColumns: { header: string; start: Date; end: Date }[] = [];
  for (const h of headers) {
    if (h === skuHeader || h === typeHeader) continue;
    const parsed = parseMonthColumn(h);
    if (parsed) monthColumns.push({ header: h, ...parsed });
  }

  if (monthColumns.length === 0) {
    errors.push({
      rowNumber: 1,
      fieldName: "headers",
      errorType: "format_error",
      message: `No month columns found. Expected formats like "Apr-25", "2025-04". Headers: ${headers.slice(0, 10).join(", ")}`,
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

  // ---- Per-row processing ----
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const itemCode = row[skuHeader] != null ? String(row[skuHeader]).trim() : "";
    if (!itemCode) {
      errors.push({
        rowNumber: rowNum,
        fieldName: skuHeader,
        errorType: "invalid_value",
        message: "SKU code is blank",
      });
      continue;
    }

    // ---- Type flag handling ----
    // If no TYPE column is present, try a last-resort scan: the first
    // single-character K/c/A cell in the row acts as an inline flag.
    let typeFlag = "";
    if (typeHeader) {
      typeFlag = row[typeHeader] != null ? String(row[typeHeader]).trim() : "";
    } else {
      for (const h of headers) {
        if (h === skuHeader) continue;
        if (monthColumns.some((m) => m.header === h)) continue;
        const v = row[h];
        if (v == null) continue;
        const s = String(v).trim();
        if (s.length === 1 && /^[KcA]$/.test(s)) {
          typeFlag = s;
          break;
        }
      }
    }

    // Assembly items: disregard entirely.
    if (typeFlag === "A") {
      skipped++;
      continue;
    }

    // ---- Look up SKU (do NOT auto-create with assembly-only data) ----
    const sku = await db.sku.findUnique({ where: { skuCode: itemCode } });
    if (!sku) {
      errors.push({
        rowNumber: rowNum,
        fieldName: skuHeader,
        errorType: "missing_sku",
        message: `SKU "${itemCode}" not found. Import WDS Inventory (STKSTATUS.txt) and Kit Composition (kititems.csv) first so SKUs exist.`,
        rawValue: itemCode,
      });
      continue;
    }

    // ---- Record each month's sales ----
    let wroteAny = false;
    for (const mc of monthColumns) {
      const raw = row[mc.header];
      if (raw === null || raw === undefined || raw === "" || raw === 0 || raw === "0") continue;

      const units = toInt(raw);
      if (units === null || units < 0) {
        errors.push({
          rowNumber: rowNum,
          fieldName: mc.header,
          errorType: "invalid_value",
          message: `Value "${raw}" in ${mc.header} is not a valid unit count`,
          rawValue: String(raw),
        });
        continue;
      }

      // For Kit Parents (K): units = kits sold (not cartons × qty). Store as-is.
      // For Components (c) and Standalone: units = direct sales. Store as-is.
      await db.salesRecord.upsert({
        where: {
          unique_sales_period: {
            skuId: sku.id,
            channel: "domestic",
            periodStartDate: mc.start,
            periodEndDate: mc.end,
          },
        },
        update: { quantity: units, importBatchId: batchId },
        create: {
          skuId: sku.id,
          channel: "domestic",
          saleDate: mc.start,
          periodStartDate: mc.start,
          periodEndDate: mc.end,
          quantity: units,
          source: "wds_export",
          importBatchId: batchId,
        },
      });

      imported++;
      wroteAny = true;
    }

    if (!wroteAny) {
      // All month cells were blank/zero — not an error, just nothing to record.
      skipped++;
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
