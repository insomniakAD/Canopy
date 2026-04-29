// ============================================================================
// WDS Monthly Sales — Staging-aware Processor (Cartons + Revenue)
// ============================================================================
// Handles two import types that share the same WDS monthly pivot format:
//   wds_monthly_cartons  → writes quantity (integer cartons/units shipped)
//   wds_monthly_sales    → writes revenueUsd (decimal sales dollars)
//
// Both reports have a metadata row 0 (e.g. "MONTH VALUES = CARTONS") and
// actual column headers in row 1. The orchestrator sets headerRow=1 for both.
//
// The core logic — value coercion, SKU lookup, payload assembly, write,
// and diff — is exported so the Vercel Blob source path (oitem-monthly.json,
// already unpivoted) can reuse it without going through the Excel parser.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseMonthColumn, toInt } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
  PeriodTotal,
  RowDelta,
} from "../staging/types";

// ---------- Types ----------

export type Mode = "cartons" | "revenue";

interface StagedSalesRow {
  skuId: string;
  skuCode: string;
  saleDate: string;
  periodStartDate: string;
  periodEndDate: string;
  periodLabel: string;
  /** Cartons mode: integer unit count. Revenue mode: dollar amount (float). */
  value: number;
}

export interface WdsMonthlySalesPayload {
  mode: Mode;
  rows: StagedSalesRow[];
}

/**
 * One value to consider for the staging payload — already resolved to a SKU
 * code and a calendar period. The Excel parser produces these from
 * (row × month-column) pairs; the JSON blob source produces them directly
 * from each `oitem-monthly` record.
 */
export interface SalesInputItem {
  skuCode: string;
  periodStartDate: Date;
  periodEndDate: Date;
  /** Defaults to periodStartDate if omitted. */
  saleDate?: Date;
  periodLabel: string;
  rawValue: unknown;
  /** 1-indexed source row number (used in error messages). */
  rowNumber: number;
  /** Source field/column name (used in error messages). */
  fieldName: string;
}

// ---------- Helpers ----------

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function parseValue(raw: unknown, mode: Mode): number | null {
  if (raw === null || raw === undefined || raw === "") return null;

  if (mode === "cartons") {
    const v = toInt(raw);
    return v !== null && v >= 0 ? v : null;
  }

  // Revenue: strip commas, parse as float
  const s = String(raw).replace(/,/g, "");
  const v = parseFloat(s);
  return !isNaN(v) && v >= 0 ? v : null;
}

/** One-shot lookup of SKU codes → ids. Empty input returns an empty map. */
export async function fetchSkuIdMap(
  db: PrismaClient,
  codes: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(codes.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const records = await db.sku.findMany({
    where: { skuCode: { in: unique } },
    select: { id: true, skuCode: true },
  });
  return new Map(records.map((s) => [s.skuCode, s.id]));
}

/**
 * Shared engine: given pre-resolved sales inputs and a SKU map, validate +
 * coerce each value and assemble the staging payload. Caller is responsible
 * for blank-SKU and missing-SKU handling (so per-row error counts can be
 * controlled at the source).
 *
 * Returns a `produced` flag per input so the caller can attribute outputs
 * back to its own row grouping.
 */
export async function buildSalesPayload(
  inputs: SalesInputItem[],
  mode: Mode,
  skuByCode: Map<string, string>,
): Promise<{
  payload: WdsMonthlySalesPayload;
  errors: ImportErrorDetail[];
  produced: boolean[];
}> {
  const errors: ImportErrorDetail[] = [];
  const payload: WdsMonthlySalesPayload = { mode, rows: [] };
  const produced = new Array<boolean>(inputs.length).fill(false);

  for (let idx = 0; idx < inputs.length; idx++) {
    const input = inputs[idx];

    const skuId = skuByCode.get(input.skuCode);
    if (!skuId) {
      // Defensive — caller should have filtered, but if it didn't, surface.
      errors.push({
        rowNumber: input.rowNumber,
        fieldName: input.fieldName,
        errorType: "missing_sku",
        message:
          `SKU "${input.skuCode}" not found. Import WDS Inventory first so SKUs exist.`,
        rawValue: input.skuCode,
      });
      continue;
    }

    if (
      input.rawValue === null ||
      input.rawValue === undefined ||
      input.rawValue === ""
    ) {
      continue;
    }

    const value = parseValue(input.rawValue, mode);
    if (value === null) {
      errors.push({
        rowNumber: input.rowNumber,
        fieldName: input.fieldName,
        errorType: "invalid_value",
        message:
          `Value "${input.rawValue}" is not a valid ${mode === "cartons" ? "unit count" : "dollar amount"}`,
        rawValue: String(input.rawValue),
      });
      continue;
    }

    if (value === 0) continue;

    const start = input.periodStartDate;
    const end = input.periodEndDate;
    const sale = input.saleDate ?? start;
    payload.rows.push({
      skuId,
      skuCode: input.skuCode,
      saleDate: sale.toISOString(),
      periodStartDate: start.toISOString(),
      periodEndDate: end.toISOString(),
      periodLabel: input.periodLabel,
      value,
    });
    produced[idx] = true;
  }

  return { payload, errors, produced };
}

// ---------- parseToPayload (Excel pivot path) ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput,
  mode: Mode,
): Promise<ParseResult<WdsMonthlySalesPayload>> {
  const { headers, rows } = input;
  const errors: ImportErrorDetail[] = [];

  // ---- Identify columns ----
  const skuHeader =
    headers.find((h) => /^ITEM\s*#?$|^SKU$|^ITEM\s*NO/i.test(h)) ?? headers[0];

  const monthColumns: { header: string; start: Date; end: Date; label: string }[] = [];
  for (const h of headers) {
    if (h === skuHeader) continue;
    const parsed = parseMonthColumn(h);
    if (parsed) {
      monthColumns.push({ header: h, ...parsed, label: monthLabel(parsed.start) });
    }
  }

  if (monthColumns.length === 0) {
    errors.push({
      rowNumber: 1,
      fieldName: "headers",
      errorType: "format_error",
      message:
        `No month columns found. Expected formats like "Apr-25", "APR 2025", "2025-04". ` +
        `Headers seen: ${headers.slice(0, 10).join(", ")}`,
    });
    return {
      payload: { mode, rows: [] },
      rowCount: rows.length,
      willImport: 0,
      willSkip: 0,
      errors,
    };
  }

  // ---- Pre-fetch SKUs once ----
  const codes = rows
    .map((row) => (row[skuHeader] != null ? String(row[skuHeader]).trim() : ""))
    .filter(Boolean);
  const skuByCode = await fetchSkuIdMap(db, codes);

  // ---- Build inputs from non-blank cells; track row → input mapping ----
  const inputs: SalesInputItem[] = [];
  const inputRowIdx: number[] = [];
  /** Excel rows that survived blank-SKU + missing-SKU checks. */
  const validSkuRows = new Set<number>();

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

    if (!skuByCode.has(itemCode)) {
      errors.push({
        rowNumber: rowNum,
        fieldName: skuHeader,
        errorType: "missing_sku",
        message: `SKU "${itemCode}" not found. Import WDS Inventory first so SKUs exist.`,
        rawValue: itemCode,
      });
      continue;
    }

    validSkuRows.add(i);

    for (const mc of monthColumns) {
      const raw = row[mc.header];
      if (raw === null || raw === undefined || raw === "") continue;
      inputs.push({
        skuCode: itemCode,
        periodStartDate: mc.start,
        periodEndDate: mc.end,
        saleDate: mc.start,
        periodLabel: mc.label,
        rawValue: raw,
        rowNumber: rowNum,
        fieldName: mc.header,
      });
      inputRowIdx.push(i);
    }
  }

  // ---- Hand off to shared engine ----
  const { payload, errors: builderErrors, produced } = await buildSalesPayload(
    inputs,
    mode,
    skuByCode,
  );
  errors.push(...builderErrors);

  // willSkip: rows with valid SKU that produced no output
  // (no months populated, or all months were blank/zero/invalid).
  const producedRows = new Set<number>();
  for (let k = 0; k < produced.length; k++) {
    if (produced[k]) producedRows.add(inputRowIdx[k]);
  }
  let willSkip = 0;
  for (const i of validSkuRows) {
    if (!producedRows.has(i)) willSkip++;
  }

  return {
    payload,
    rowCount: rows.length,
    willImport: payload.rows.length,
    willSkip,
    errors,
  };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  batchId: string,
  payload: WdsMonthlySalesPayload,
): Promise<WriteResult> {
  const { mode, rows } = payload;
  let imported = 0;

  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const where = {
        unique_sales_period: {
          skuId: row.skuId,
          channel: "domestic",
          periodStartDate: new Date(row.periodStartDate),
          periodEndDate: new Date(row.periodEndDate),
        },
      } as const;

      if (mode === "cartons") {
        const qty = Math.round(row.value);
        await tx.salesRecord.upsert({
          where,
          update: { quantity: qty, importBatchId: batchId },
          create: {
            skuId: row.skuId,
            channel: "domestic",
            saleDate: new Date(row.saleDate),
            periodStartDate: new Date(row.periodStartDate),
            periodEndDate: new Date(row.periodEndDate),
            quantity: qty,
            source: "wds_export",
            importBatchId: batchId,
          },
        });
      } else {
        // Revenue mode — only update revenueUsd; quantity defaults to 0 on create
        await tx.salesRecord.upsert({
          where,
          update: { revenueUsd: row.value, importBatchId: batchId },
          create: {
            skuId: row.skuId,
            channel: "domestic",
            saleDate: new Date(row.saleDate),
            periodStartDate: new Date(row.periodStartDate),
            periodEndDate: new Date(row.periodEndDate),
            quantity: 0,
            revenueUsd: row.value,
            source: "wds_export",
            importBatchId: batchId,
          },
        });
      }

      imported++;
    }
  }, { timeout: 120000 });

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: WdsMonthlySalesPayload,
): Promise<DiffSummary> {
  const { mode, rows } = payload;

  if (rows.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings: [] };
  }

  const skuIds = Array.from(new Set(rows.map((r) => r.skuId)));
  const periodStarts = Array.from(new Set(rows.map((r) => r.periodStartDate)));

  const existing = await db.salesRecord.findMany({
    where: {
      skuId: { in: skuIds },
      channel: "domestic",
      periodStartDate: { in: periodStarts.map((d) => new Date(d)) },
    },
    select: {
      skuId: true,
      periodStartDate: true,
      periodEndDate: true,
      quantity: true,
      revenueUsd: true,
    },
  });

  const existingKey = (skuId: string, startIso: string, endIso: string) =>
    `${skuId}|${startIso}|${endIso}`;

  // Map existing records keyed → current value for the relevant field
  const existingMap = new Map<string, number | null>();
  for (const e of existing) {
    const val =
      mode === "cartons"
        ? e.quantity
        : e.revenueUsd != null
        ? Number(e.revenueUsd)
        : null;
    existingMap.set(
      existingKey(e.skuId, e.periodStartDate.toISOString(), e.periodEndDate.toISOString()),
      val,
    );
  }

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;

  const periodAgg = new Map<string, { period: string; previousTotal: number; newTotal: number }>();
  const perPeriodOrder: string[] = [];
  const rowDeltas: RowDelta[] = [];

  for (const row of rows) {
    const key = existingKey(row.skuId, row.periodStartDate, row.periodEndDate);
    const prior = existingMap.get(key);

    if (prior === undefined || prior === null) {
      newRows++;
      rowDeltas.push({
        skuCode: row.skuCode,
        period: row.periodLabel,
        previous: null,
        next: row.value,
        delta: row.value,
      });
    } else if (prior === row.value) {
      unchangedRows++;
    } else {
      updatedRows++;
      rowDeltas.push({
        skuCode: row.skuCode,
        period: row.periodLabel,
        previous: prior,
        next: row.value,
        delta: row.value - prior,
      });
    }

    if (!periodAgg.has(row.periodLabel)) {
      periodAgg.set(row.periodLabel, { period: row.periodLabel, previousTotal: 0, newTotal: 0 });
      perPeriodOrder.push(row.periodLabel);
    }
    const bucket = periodAgg.get(row.periodLabel)!;
    bucket.newTotal += row.value;
    bucket.previousTotal += prior ?? 0;
  }

  const periodTotals: PeriodTotal[] = perPeriodOrder.map((label) => {
    const b = periodAgg.get(label)!;
    const delta = b.newTotal - b.previousTotal;
    const deltaPct = b.previousTotal === 0 ? null : (delta / b.previousTotal) * 100;
    return { period: label, previousTotal: b.previousTotal, newTotal: b.newTotal, delta, deltaPct };
  });

  const topDeltas = [...rowDeltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);

  const warnings: GateCheckResult["softFails"] = [];
  for (const pt of periodTotals) {
    if (pt.deltaPct !== null && Math.abs(pt.deltaPct) >= 50 && pt.previousTotal > 0) {
      warnings.push({
        code: "period_total_swing",
        message: `${pt.period} total changes ${pt.deltaPct > 0 ? "+" : ""}${pt.deltaPct.toFixed(0)}% (${pt.previousTotal.toLocaleString()} → ${pt.newTotal.toLocaleString()}).`,
      });
    }
  }

  return { totalStagedRows: rows.length, newRows, updatedRows, unchangedRows, periodTotals, topDeltas, warnings };
}

// ---------- Factory + exports ----------

function createProcessor(mode: Mode): ProcessorStagingContract<WdsMonthlySalesPayload> {
  return {
    parseToPayload: (db, input) => parseToPayload(db, input, mode),
    writeFromPayload,
    computeDiff,
    runGates: async (): Promise<GateCheckResult> => ({ hardFails: [], softFails: [] }),
  };
}

/** wds_monthly_sales import type — Sales Dollars (revenue per SKU per month). */
export const wdsMonthlySalesStaging = createProcessor("revenue");

/** wds_monthly_cartons import type — Cartons/units shipped per SKU per month. */
export const wdsMonthlyCartonsStaging = createProcessor("cartons");

// Reusable building blocks for non-Excel sources (e.g. blob JSON).
export {
  writeFromPayload as writeMonthlySalesPayload,
  computeDiff as computeMonthlySalesDiff,
};
