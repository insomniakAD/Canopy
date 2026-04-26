// ============================================================================
// Amazon Sales — Staging-aware Processor
// ============================================================================
// One SalesRecord per ASIN per reporting period (channel: amazon_1p).
// Date range is parsed from the Amazon metadata row (row 0) inside the buffer.
// Payload stores one row per ASIN; diff compares units vs the prior import for
// the same period, and warns on >50% total unit swing.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseAmazonMeta, toInt, toNumber } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
  RowDelta,
} from "../staging/types";

// ---------- Payload shape ----------

interface StagedAmazonSalesRow {
  skuId: string;
  skuCode: string;
  shippedUnits: number;
  shippedRevenue: number | null;
  shippedCogs: number | null;
}

export interface AmazonSalesPayload {
  rows: StagedAmazonSalesRow[];
  periodStartDate: string;
  periodEndDate: string;
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<AmazonSalesPayload>> {
  const { buffer, rows } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: AmazonSalesPayload = { rows: [], periodStartDate: "", periodEndDate: "" };

  // Extract date range from Amazon metadata row 0
  const meta = parseAmazonMeta(buffer);
  if (!meta.reportDateRange) {
    errors.push({
      rowNumber: 0,
      fieldName: "metadata",
      errorType: "format_error",
      message:
        "Could not find date range in report metadata. Expected 'Viewing Range=[start - end]' in row 1.",
    });
    return { payload, rowCount: rows.length, willImport: 0, willSkip: 0, errors };
  }

  const { start: periodStart, end: periodEnd } = meta.reportDateRange;
  payload.periodStartDate = periodStart.toISOString();
  payload.periodEndDate = periodEnd.toISOString();

  // Pre-fetch all ASINs present in the file
  const asins = rows
    .map((r) => (r["ASIN"] != null ? String(r["ASIN"]).trim() : ""))
    .filter(Boolean);

  const skuRecords = asins.length
    ? await db.sku.findMany({
        where: { asin: { in: asins } },
        select: { id: true, skuCode: true, asin: true },
      })
    : [];
  const skuByAsin = new Map(skuRecords.map((s) => [s.asin!, { id: s.id, code: s.skuCode }]));

  let willSkip = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 3; // meta row + header row + 1-based

    const asin = row["ASIN"] != null ? String(row["ASIN"]).trim() : "";
    if (!asin) {
      errors.push({ rowNumber: rowNum, fieldName: "ASIN", errorType: "invalid_value", message: "ASIN is blank" });
      continue;
    }

    const skuInfo = skuByAsin.get(asin);
    if (!skuInfo) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ASIN",
        errorType: "unmapped_asin",
        message: `ASIN "${asin}" is not linked to any Winsome SKU. Upload an ASIN mapping first.`,
        rawValue: asin,
      });
      continue;
    }

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

    if (shippedUnits === 0) {
      willSkip++;
      continue;
    }

    payload.rows.push({
      skuId: skuInfo.id,
      skuCode: skuInfo.code,
      shippedUnits,
      shippedRevenue: toNumber(row["Shipped Revenue"]),
      shippedCogs: toNumber(row["Shipped COGS"]),
    });
  }

  return { payload, rowCount: rows.length, willImport: payload.rows.length, willSkip, errors };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  batchId: string,
  payload: AmazonSalesPayload
): Promise<WriteResult> {
  const periodStart = new Date(payload.periodStartDate);
  const periodEnd = new Date(payload.periodEndDate);
  let imported = 0;

  await db.$transaction(async (tx) => {
    for (const row of payload.rows) {
      await tx.salesRecord.upsert({
        where: {
          unique_sales_period: {
            skuId: row.skuId,
            channel: "amazon_1p",
            periodStartDate: periodStart,
            periodEndDate: periodEnd,
          },
        },
        update: {
          quantity: row.shippedUnits,
          revenueUsd: row.shippedRevenue,
          costUsd: row.shippedCogs,
          importBatchId: batchId,
        },
        create: {
          skuId: row.skuId,
          channel: "amazon_1p",
          saleDate: periodStart,
          periodStartDate: periodStart,
          periodEndDate: periodEnd,
          quantity: row.shippedUnits,
          revenueUsd: row.shippedRevenue,
          costUsd: row.shippedCogs,
          source: "amazon_report",
          importBatchId: batchId,
        },
      });
      imported++;
    }
  }, { timeout: 30000 });

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: AmazonSalesPayload
): Promise<DiffSummary> {
  if (payload.rows.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings: [] };
  }

  const periodStart = new Date(payload.periodStartDate);
  const periodEnd = new Date(payload.periodEndDate);
  const skuIds = payload.rows.map((r) => r.skuId);

  const existing = await db.salesRecord.findMany({
    where: {
      skuId: { in: skuIds },
      channel: "amazon_1p",
      periodStartDate: periodStart,
      periodEndDate: periodEnd,
    },
    select: { skuId: true, quantity: true },
  });
  const existingMap = new Map(existing.map((e) => [e.skuId, e.quantity]));

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  const rowDeltas: RowDelta[] = [];
  let prevTotalUnits = 0;
  let newTotalUnits = 0;

  for (const row of payload.rows) {
    const prior = existingMap.get(row.skuId);
    newTotalUnits += row.shippedUnits;
    if (prior === undefined) {
      newRows++;
      rowDeltas.push({ skuCode: row.skuCode, previous: null, next: row.shippedUnits, delta: row.shippedUnits });
    } else {
      prevTotalUnits += prior;
      if (prior === row.shippedUnits) {
        unchangedRows++;
      } else {
        updatedRows++;
        rowDeltas.push({ skuCode: row.skuCode, previous: prior, next: row.shippedUnits, delta: row.shippedUnits - prior });
      }
    }
  }

  const topDeltas = [...rowDeltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);
  const warnings: GateCheckResult["softFails"] = [];

  if (prevTotalUnits > 0) {
    const swing = ((newTotalUnits - prevTotalUnits) / prevTotalUnits) * 100;
    if (Math.abs(swing) >= 50) {
      warnings.push({
        code: "period_units_swing",
        message: `Total shipped units change ${swing > 0 ? "+" : ""}${swing.toFixed(0)}% vs prior import for this period (${prevTotalUnits.toLocaleString()} → ${newTotalUnits.toLocaleString()}).`,
      });
    }
  }

  return { totalStagedRows: payload.rows.length, newRows, updatedRows, unchangedRows, topDeltas, warnings };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const amazonSalesStaging: ProcessorStagingContract<AmazonSalesPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
