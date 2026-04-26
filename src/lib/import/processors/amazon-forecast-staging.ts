// ============================================================================
// Amazon Forecast — Staging-aware Processor
// ============================================================================
// 48 weekly forecast rows per ASIN from the Amazon Mean Forecast export.
// Row 0 = metadata (including Forecasting Statistic), Row 1 = actual headers.
//
// Diff: new vs updated week-rows, near-term (weeks 0–3) total delta.
// Soft warning: >30% drop in total forecast units across weeks 0–3 vs the
// most recent snapshot — signals a potential Amazon pull-back.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseAmazonMeta, parseForecastWeekHeader, toNumber } from "../utils";
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

interface StagedForecastRow {
  skuId: string;
  skuCode: string;
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
  forecastUnits: number;
}

export interface AmazonForecastPayload {
  rows: StagedForecastRow[];
  snapshotDate: string;
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<AmazonForecastPayload>> {
  const { buffer, headers, rows, today } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: AmazonForecastPayload = { rows: [], snapshotDate: today.toISOString() };

  // Validate forecast statistic from metadata row
  const meta = parseAmazonMeta(buffer);
  if (meta.forecastStatistic && meta.forecastStatistic.toLowerCase() !== "mean") {
    errors.push({
      rowNumber: 0,
      fieldName: "Forecasting Statistic",
      errorType: "format_error",
      message: `This file is a ${meta.forecastStatistic} forecast. Canopy only uses the Mean forecast. Re-export from Amazon with Forecasting Statistic = Mean.`,
      rawValue: meta.forecastStatistic,
    });
    return { payload, rowCount: rows.length, willImport: 0, willSkip: 0, errors };
  }

  // Identify week columns
  const weekColumns: { header: string; weekNumber: number; startDate: Date; endDate: Date }[] = [];
  for (const h of headers) {
    const parsed = parseForecastWeekHeader(h);
    if (parsed) weekColumns.push({ header: h, ...parsed });
  }

  if (weekColumns.length === 0) {
    errors.push({
      rowNumber: 1,
      fieldName: "headers",
      errorType: "format_error",
      message: `No weekly forecast columns found. Expected format: "Week 0 (29 Mar - 4 Apr)". Found: ${headers.slice(3, 6).join(", ")}`,
    });
    return { payload, rowCount: rows.length, willImport: 0, willSkip: 0, errors };
  }

  // Pre-fetch SKUs by ASIN
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
    const rowNum = i + 3; // meta + header + 1-based

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

    let addedAny = false;
    for (const wc of weekColumns) {
      const forecastUnits = toNumber(row[wc.header]);
      if (forecastUnits === null) continue;

      payload.rows.push({
        skuId: skuInfo.id,
        skuCode: skuInfo.code,
        weekNumber: wc.weekNumber,
        weekStartDate: wc.startDate.toISOString(),
        weekEndDate: wc.endDate.toISOString(),
        forecastUnits,
      });
      addedAny = true;
    }
    if (!addedAny) willSkip++;
  }

  return { payload, rowCount: rows.length, willImport: payload.rows.length, willSkip, errors };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  batchId: string,
  payload: AmazonForecastPayload
): Promise<WriteResult> {
  const snapshotDate = new Date(payload.snapshotDate);
  let imported = 0;

  await db.$transaction(async (tx) => {
    for (const row of payload.rows) {
      await tx.amazonForecast.upsert({
        where: {
          unique_forecast_week: {
            skuId: row.skuId,
            weekStartDate: new Date(row.weekStartDate),
            snapshotDate,
          },
        },
        update: {
          weekNumber: row.weekNumber,
          weekEndDate: new Date(row.weekEndDate),
          forecastUnits: row.forecastUnits,
          importBatchId: batchId,
        },
        create: {
          skuId: row.skuId,
          weekNumber: row.weekNumber,
          weekStartDate: new Date(row.weekStartDate),
          weekEndDate: new Date(row.weekEndDate),
          forecastUnits: row.forecastUnits,
          snapshotDate,
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
  payload: AmazonForecastPayload
): Promise<DiffSummary> {
  if (payload.rows.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings: [] };
  }

  const snapshotDate = new Date(payload.snapshotDate);
  const skuIds = Array.from(new Set(payload.rows.map((r) => r.skuId)));
  const weekStarts = Array.from(new Set(payload.rows.map((r) => r.weekStartDate)));

  // Prior snapshot: the most recent one before today that has data for these SKUs
  const latestSnapshotRec = await db.amazonForecast.findFirst({
    where: { skuId: { in: skuIds }, snapshotDate: { lt: snapshotDate } },
    orderBy: { snapshotDate: "desc" },
    select: { snapshotDate: true },
  });

  const existingRows = latestSnapshotRec
    ? await db.amazonForecast.findMany({
        where: {
          skuId: { in: skuIds },
          snapshotDate: latestSnapshotRec.snapshotDate,
          weekStartDate: { in: weekStarts.map((d) => new Date(d)) },
        },
        select: { skuId: true, weekStartDate: true, forecastUnits: true, weekNumber: true },
      })
    : [];

  const existingKey = (skuId: string, weekStart: string) => `${skuId}|${weekStart}`;
  const existingMap = new Map(
    existingRows.map((e) => [existingKey(e.skuId, e.weekStartDate.toISOString()), { units: Number(e.forecastUnits), week: e.weekNumber }])
  );

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  const rowDeltas: RowDelta[] = [];

  // Period totals: roll up weeks 0–3 (near-term) and weeks 4–11 (mid-term)
  const nearTermPrev: number[] = [0, 0, 0, 0];
  const nearTermNew: number[] = [0, 0, 0, 0];

  for (const row of payload.rows) {
    const key = existingKey(row.skuId, row.weekStartDate);
    const prior = existingMap.get(key);

    if (row.weekNumber < 4) {
      nearTermNew[row.weekNumber] += row.forecastUnits;
      if (prior) nearTermPrev[row.weekNumber] += Number(prior.units);
    }

    if (!prior) {
      newRows++;
      rowDeltas.push({
        skuCode: row.skuCode,
        period: `Week ${row.weekNumber}`,
        previous: null,
        next: row.forecastUnits,
        delta: row.forecastUnits,
      });
    } else if (Math.round(prior.units * 100) === Math.round(row.forecastUnits * 100)) {
      unchangedRows++;
    } else {
      updatedRows++;
      rowDeltas.push({
        skuCode: row.skuCode,
        period: `Week ${row.weekNumber}`,
        previous: prior.units,
        next: row.forecastUnits,
        delta: row.forecastUnits - prior.units,
      });
    }
  }

  const topDeltas = [...rowDeltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);

  // Period totals for weeks 0–3
  const periodTotals: PeriodTotal[] = nearTermNew.map((newTotal, i) => {
    const prevTotal = nearTermPrev[i];
    const delta = newTotal - prevTotal;
    const deltaPct = prevTotal === 0 ? null : (delta / prevTotal) * 100;
    return { period: `Week ${i}`, previousTotal: prevTotal, newTotal, delta, deltaPct };
  });

  const warnings: GateCheckResult["softFails"] = [];
  const prevNearTotal = nearTermPrev.reduce((s, v) => s + v, 0);
  const newNearTotal = nearTermNew.reduce((s, v) => s + v, 0);

  if (prevNearTotal > 0) {
    const swing = ((newNearTotal - prevNearTotal) / prevNearTotal) * 100;
    if (swing <= -30) {
      warnings.push({
        code: "near_term_forecast_drop",
        message: `Weeks 0–3 total forecast drops ${swing.toFixed(0)}% vs prior snapshot (${prevNearTotal.toFixed(0)} → ${newNearTotal.toFixed(0)} units). Review before committing — this may signal Amazon pulling back orders.`,
      });
    }
  }

  return { totalStagedRows: payload.rows.length, newRows, updatedRows, unchangedRows, periodTotals, topDeltas, warnings };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const amazonForecastStaging: ProcessorStagingContract<AmazonForecastPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
