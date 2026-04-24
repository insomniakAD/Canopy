// ============================================================================
// WDS Monthly Sales — Staging-aware Processor
// ============================================================================
// Canonical example of the two-phase (stage → commit) contract. The parse
// phase resolves every SKU upfront so commit becomes a simple upsert loop.
//
// Payload is an array of normalized (SKU × month) sales rows, one per cell
// that had a non-zero unit count.
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

// ---------- Payload shape ----------

interface StagedSalesRow {
  skuId: string;        // resolved during parse
  skuCode: string;      // for display in diff/errors
  saleDate: string;     // ISO date
  periodStartDate: string;
  periodEndDate: string;
  /** Label used for period-level roll-ups. e.g. "Mar 2025". */
  periodLabel: string;
  quantity: number;
}

export interface WdsMonthlySalesPayload {
  rows: StagedSalesRow[];
}

// ---------- Helpers ----------

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<WdsMonthlySalesPayload>> {
  const { headers, rows } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: WdsMonthlySalesPayload = { rows: [] };
  let willSkip = 0;

  // ---- Identify columns ----
  const skuHeader = headers.find((h) => /^ITEM\s*#?$|^SKU$|^ITEM\s*NO/i.test(h)) ?? headers[0];
  const typeHeader = headers.find((h) => /^TYPE$|^FLAG$|^KIT$|^KIND$/i.test(h)) ?? null;

  const monthColumns: { header: string; start: Date; end: Date; label: string }[] = [];
  for (const h of headers) {
    if (h === skuHeader || h === typeHeader) continue;
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
        `No month columns found. Expected formats like "Apr-25", "2025-04". ` +
        `Headers: ${headers.slice(0, 10).join(", ")}`,
    });
    return { payload, rowCount: rows.length, willImport: 0, willSkip: 0, errors };
  }

  // ---- Pre-fetch SKUs in one query to avoid N+1 ----
  const codes = rows
    .map((row) => (row[skuHeader] != null ? String(row[skuHeader]).trim() : ""))
    .filter(Boolean);
  const skuRecords = codes.length
    ? await db.sku.findMany({
        where: { skuCode: { in: codes } },
        select: { id: true, skuCode: true },
      })
    : [];
  const skuByCode = new Map(skuRecords.map((s) => [s.skuCode, s.id]));

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

    if (typeFlag === "A") {
      willSkip++;
      continue;
    }

    const skuId = skuByCode.get(itemCode);
    if (!skuId) {
      errors.push({
        rowNumber: rowNum,
        fieldName: skuHeader,
        errorType: "missing_sku",
        message:
          `SKU "${itemCode}" not found. Import WDS Inventory (STKSTATUS.txt) ` +
          `and Kit Composition (kititems.csv) first so SKUs exist.`,
        rawValue: itemCode,
      });
      continue;
    }

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

      payload.rows.push({
        skuId,
        skuCode: itemCode,
        saleDate: mc.start.toISOString(),
        periodStartDate: mc.start.toISOString(),
        periodEndDate: mc.end.toISOString(),
        periodLabel: mc.label,
        quantity: units,
      });
      wroteAny = true;
    }

    if (!wroteAny) willSkip++;
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
  payload: WdsMonthlySalesPayload
): Promise<WriteResult> {
  let imported = 0;
  for (const row of payload.rows) {
    await db.salesRecord.upsert({
      where: {
        unique_sales_period: {
          skuId: row.skuId,
          channel: "domestic",
          periodStartDate: new Date(row.periodStartDate),
          periodEndDate: new Date(row.periodEndDate),
        },
      },
      update: { quantity: row.quantity, importBatchId: batchId },
      create: {
        skuId: row.skuId,
        channel: "domestic",
        saleDate: new Date(row.saleDate),
        periodStartDate: new Date(row.periodStartDate),
        periodEndDate: new Date(row.periodEndDate),
        quantity: row.quantity,
        source: "wds_export",
        importBatchId: batchId,
      },
    });
    imported++;
  }
  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: WdsMonthlySalesPayload
): Promise<DiffSummary> {
  if (payload.rows.length === 0) {
    return {
      totalStagedRows: 0,
      newRows: 0,
      updatedRows: 0,
      unchangedRows: 0,
      warnings: [],
    };
  }

  // ---- Fetch existing SalesRecords that overlap our staged rows ----
  const skuIds = Array.from(new Set(payload.rows.map((r) => r.skuId)));
  const periodStarts = Array.from(new Set(payload.rows.map((r) => r.periodStartDate)));

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
    },
  });

  const existingKey = (skuId: string, startIso: string, endIso: string) =>
    `${skuId}|${startIso}|${endIso}`;
  const existingMap = new Map<string, number>();
  for (const e of existing) {
    existingMap.set(
      existingKey(e.skuId, e.periodStartDate.toISOString(), e.periodEndDate.toISOString()),
      e.quantity
    );
  }

  // ---- Bucket diffs per period + collect row-level deltas ----
  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;

  const periodAgg = new Map<
    string,
    { period: string; previousTotal: number; newTotal: number }
  >();
  const perPeriodOrder: string[] = []; // preserve first-seen order

  const rowDeltas: RowDelta[] = [];

  for (const row of payload.rows) {
    const key = existingKey(row.skuId, row.periodStartDate, row.periodEndDate);
    const prior = existingMap.get(key);

    if (prior === undefined) {
      newRows++;
      rowDeltas.push({
        skuCode: row.skuCode,
        period: row.periodLabel,
        previous: null,
        next: row.quantity,
        delta: row.quantity,
      });
    } else if (prior === row.quantity) {
      unchangedRows++;
    } else {
      updatedRows++;
      rowDeltas.push({
        skuCode: row.skuCode,
        period: row.periodLabel,
        previous: prior,
        next: row.quantity,
        delta: row.quantity - prior,
      });
    }

    // Period roll-up
    if (!periodAgg.has(row.periodLabel)) {
      periodAgg.set(row.periodLabel, {
        period: row.periodLabel,
        previousTotal: 0,
        newTotal: 0,
      });
      perPeriodOrder.push(row.periodLabel);
    }
    const bucket = periodAgg.get(row.periodLabel)!;
    bucket.newTotal += row.quantity;
    bucket.previousTotal += prior ?? 0;
  }

  const periodTotals: PeriodTotal[] = perPeriodOrder.map((label) => {
    const b = periodAgg.get(label)!;
    const delta = b.newTotal - b.previousTotal;
    const deltaPct = b.previousTotal === 0 ? null : (delta / b.previousTotal) * 100;
    return {
      period: label,
      previousTotal: b.previousTotal,
      newTotal: b.newTotal,
      delta,
      deltaPct,
    };
  });

  // Top deltas: by absolute delta, cap at 20
  const topDeltas = [...rowDeltas]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 20);

  // Period-total soft warnings (>50% swing)
  const warnings: GateCheckResult["softFails"] = [];
  for (const pt of periodTotals) {
    if (pt.deltaPct !== null && Math.abs(pt.deltaPct) >= 50 && pt.previousTotal > 0) {
      warnings.push({
        code: "period_total_swing",
        message: `${pt.period} total changes ${pt.deltaPct > 0 ? "+" : ""}${pt.deltaPct.toFixed(0)}% (${pt.previousTotal.toLocaleString()} → ${pt.newTotal.toLocaleString()}).`,
      });
    }
  }

  return {
    totalStagedRows: payload.rows.length,
    newRows,
    updatedRows,
    unchangedRows,
    periodTotals,
    topDeltas,
    warnings,
  };
}

// ---------- runGates (processor-specific) ----------

async function runGates(): Promise<GateCheckResult> {
  // Hard/soft gates specific to WDS Monthly Sales can be added here.
  // For V1, we rely on per-row validation during parse plus the shared gates
  // in the framework. Period-swing warnings are surfaced via the diff.
  return { hardFails: [], softFails: [] };
}

// ---------- Contract export ----------

export const wdsMonthlySalesStaging: ProcessorStagingContract<WdsMonthlySalesPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
