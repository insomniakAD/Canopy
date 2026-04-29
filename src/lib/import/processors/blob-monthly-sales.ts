// ============================================================================
// Blob Monthly Sales — Adapter for Golf's oitem-monthly.json
// ============================================================================
// Golf's blob is already unpivoted: one row per (partNum, year, month, qtyOrd).
// This adapter validates the schema, builds SalesInputItems, and hands off to
// the shared engine in wds-monthly-sales-staging.ts. Output payload is byte-
// identical to what the Excel "wds_monthly_cartons" path produces, so the
// existing diff / write / commit pipeline applies unchanged.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { BlobTable } from "@/lib/blob/source";
import type { ImportErrorDetail } from "../types";
import type { ParseResult } from "../staging/types";
import {
  buildSalesPayload,
  fetchSkuIdMap,
  type SalesInputItem,
  type WdsMonthlySalesPayload,
} from "./wds-monthly-sales-staging";

const REQUIRED_FIELDS = ["partNum", "year", "month", "qtyOrd"] as const;

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

/**
 * Parse oitem-monthly.json into a staging payload for `wds_monthly_cartons`.
 * Returns the same `ParseResult` shape as the Excel processor so the rest of
 * the staging pipeline (gates, diff, commit) is reusable.
 */
export async function parseOitemMonthlyBlob(
  db: PrismaClient,
  blob: BlobTable,
): Promise<ParseResult<WdsMonthlySalesPayload>> {
  const errors: ImportErrorDetail[] = [];
  const emptyPayload: WdsMonthlySalesPayload = { mode: "cartons", rows: [] };

  // ---- Field schema validation ----
  const idx = {
    partNum: blob.fields.indexOf("partNum"),
    year: blob.fields.indexOf("year"),
    month: blob.fields.indexOf("month"),
    qtyOrd: blob.fields.indexOf("qtyOrd"),
  };

  const missing = REQUIRED_FIELDS.filter((f) => blob.fields.indexOf(f) < 0);
  if (missing.length > 0) {
    errors.push({
      rowNumber: 1,
      fieldName: "fields",
      errorType: "format_error",
      message:
        `oitem-monthly.json is missing required field(s): ${missing.join(", ")}. ` +
        `Got: [${blob.fields.join(", ")}]`,
    });
    return {
      payload: emptyPayload,
      rowCount: blob.rows.length,
      willImport: 0,
      willSkip: 0,
      errors,
    };
  }

  // ---- Pre-fetch SKUs ----
  const codes: string[] = [];
  for (const row of blob.rows) {
    const v = row[idx.partNum];
    if (v != null && String(v).trim() !== "") codes.push(String(v).trim());
  }
  const skuByCode = await fetchSkuIdMap(db, codes);

  // ---- Per-row validation + SalesInputItem construction ----
  const inputs: SalesInputItem[] = [];
  /** JSON rows that survived blank-/missing-SKU + invalid-period checks. */
  const validRows = new Set<number>();

  for (let i = 0; i < blob.rows.length; i++) {
    const row = blob.rows[i];
    const rowNum = i + 1;

    const partNum = row[idx.partNum] != null ? String(row[idx.partNum]).trim() : "";
    if (!partNum) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "partNum",
        errorType: "invalid_value",
        message: "partNum is blank",
      });
      continue;
    }

    if (!skuByCode.has(partNum)) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "partNum",
        errorType: "missing_sku",
        message:
          `SKU "${partNum}" not found. Import WDS Active Items first so SKUs exist.`,
        rawValue: partNum,
      });
      continue;
    }

    const year = asInt(row[idx.year]);
    const month = asInt(row[idx.month]);
    if (year === null || year < 1990 || year > 2100) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "year",
        errorType: "invalid_value",
        message: `year "${row[idx.year]}" is not a valid 4-digit year`,
        rawValue: String(row[idx.year]),
      });
      continue;
    }
    if (month === null || month < 1 || month > 12) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "month",
        errorType: "invalid_value",
        message: `month "${row[idx.month]}" is not 1-12`,
        rawValue: String(row[idx.month]),
      });
      continue;
    }

    // Match parseMonthColumn() in utils.ts: local-time start/end so upsert
    // keys collide between Excel and blob sources.
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0); // last day of month

    inputs.push({
      skuCode: partNum,
      periodStartDate: start,
      periodEndDate: end,
      saleDate: start,
      periodLabel: `${MONTH_LABELS[month - 1]} ${year}`,
      rawValue: row[idx.qtyOrd],
      rowNumber: rowNum,
      fieldName: "qtyOrd",
    });
    validRows.add(i);
  }

  // ---- Hand off to shared engine ----
  const { payload, errors: builderErrors, produced } = await buildSalesPayload(
    inputs,
    "cartons",
    skuByCode,
  );
  errors.push(...builderErrors);

  // willSkip: rows with valid SKU + valid period that produced no output
  // (qtyOrd was blank, zero, or invalid).
  const producedRowSet = new Set<number>();
  // produced[k] aligns with inputs[k]; we walked validRows in order, so
  // recover the original row index by walking validRows in iteration order.
  let k = 0;
  for (const rowIdx of validRows) {
    if (produced[k]) producedRowSet.add(rowIdx);
    k++;
  }
  let willSkip = 0;
  for (const rowIdx of validRows) {
    if (!producedRowSet.has(rowIdx)) willSkip++;
  }

  return {
    payload,
    rowCount: blob.rows.length,
    willImport: payload.rows.length,
    willSkip,
    errors,
  };
}
