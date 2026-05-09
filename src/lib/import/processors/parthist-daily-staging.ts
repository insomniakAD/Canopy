// ============================================================================
// WDS parthist-daily — Staging-aware Processor
// ============================================================================
// Source: parthist-daily.json (Vercel Blob, populated by Golf's purchasing-sync
// service from WDS).
//
// Different in kind from parthist.json:
//   parthist        = monthly transaction log (qty sold, received, etc.)
//   parthist-daily  = daily inventory state snapshot (on-hand, EDI cap)
//
// Schema per row:
//   partNum       — Winsome SKU
//   date          — YYYY-MM-DD
//   onHand        — actual warehouse qty-onhand
//   availEdi      — capped value sent to EDI feeds (customer-visible)
//   availDsfeed   — drop-ship feed cap
//
// Caveats Canopy must respect:
//   1. ~700 SKUs only (active SKUs with EDI feed obligations).
//      SKUs not in the file are NOT created by this importer — they're skipped
//      with "no history tracked." Falling back to projection-only is a UI concern.
//   2. Weekday-only. No Sat/Sun rows. Step-function carry-forward through the
//      weekend is a READ-time concern (chart rendering, demand calc) — do NOT
//      generate synthetic Sat/Sun rows on import.
//   3. History starts 2025-06-23.
//   4. LOC 1 (Woodinville Warehouse) only. No location field — these are
//      warehouse snapshots only.
//
// Idempotency strategy: delete-and-insert by (sku, location, date range) scope.
// Re-importing the same payload yields the same DB state.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
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

interface StagedParthistDailyRow {
  skuCode: string;
  /** ISO date YYYY-MM-DD. */
  date: string;
  onHand: number;
  availEdi: number | null;
  availDsfeed: number | null;
}

export interface ParthistDailyPayload {
  rows: StagedParthistDailyRow[];
  locationId: string;
  earliestDate: string;
  latestDate: string;
  uniqueSkus: number;
  unknownSkuCodes: string[];
}

// ---------- Helpers ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

function asOptionalInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  return asInt(v);
}

/**
 * Accept either a top-level array or a wrapped { data: [] } / { rows: [] }
 * envelope. Golf has used both shapes in the past; tolerate both.
 */
function extractRecords(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.rows)) return obj.rows;
    if (Array.isArray(obj.records)) return obj.records;
  }
  return null;
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput,
): Promise<ParseResult<ParthistDailyPayload>> {
  const { buffer } = input;
  const errors: ImportErrorDetail[] = [];

  const location = await db.inventoryLocation.findFirst({
    where: { name: "Woodinville Warehouse" },
  });
  if (!location) {
    throw new Error(
      "Woodinville Warehouse location not found. Run seed first.",
    );
  }

  const emptyPayload: ParthistDailyPayload = {
    rows: [],
    locationId: location.id,
    earliestDate: "",
    latestDate: "",
    uniqueSkus: 0,
    unknownSkuCodes: [],
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch (e) {
    errors.push({
      rowNumber: 0,
      errorType: "format_error",
      message: `Invalid JSON: ${(e as Error).message}`,
    });
    return { payload: emptyPayload, rowCount: 0, willImport: 0, willSkip: 0, errors };
  }

  const records = extractRecords(parsed);
  if (!records) {
    errors.push({
      rowNumber: 0,
      errorType: "format_error",
      message:
        "Expected a JSON array or an object with a `data` / `rows` / `records` property.",
    });
    return { payload: emptyPayload, rowCount: 0, willImport: 0, willSkip: 0, errors };
  }

  // Pre-fetch all SKU codes so we can flag unknown SKUs without creating them.
  // Golf's parthist-daily covers EDI-obligated SKUs only — Canopy should NOT
  // auto-create SKUs from this file (use winpart.json / item update for that).
  const allSkus = await db.sku.findMany({ select: { skuCode: true } });
  const knownSkuSet = new Set(allSkus.map((s) => s.skuCode));

  const rows: StagedParthistDailyRow[] = [];
  let earliestDate = "9999-12-31";
  let latestDate = "0000-01-01";
  const skuSet = new Set<string>();
  const unknownSkus = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i] as Record<string, unknown>;
    const rowNum = i + 1;

    const partNum = r?.partNum;
    if (typeof partNum !== "string" || partNum.trim() === "") {
      errors.push({
        rowNumber: rowNum,
        fieldName: "partNum",
        errorType: "format_error",
        message: "Missing or invalid partNum",
      });
      continue;
    }
    const skuCode = partNum.trim();

    const dateRaw = r?.date;
    if (typeof dateRaw !== "string" || !ISO_DATE.test(dateRaw)) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "date",
        errorType: "format_error",
        message: "Missing or invalid date (expected YYYY-MM-DD)",
        rawValue: typeof dateRaw === "string" ? dateRaw : String(dateRaw ?? ""),
      });
      continue;
    }

    const onHand = asInt(r?.onHand);
    if (onHand === null) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "onHand",
        errorType: "invalid_value",
        message: "onHand is not a valid integer",
        rawValue: String(r?.onHand ?? ""),
      });
      continue;
    }

    if (!knownSkuSet.has(skuCode)) {
      unknownSkus.add(skuCode);
      // Not an error per se — but we don't write rows for unknown SKUs.
      // Surface count/sample in computeDiff warnings instead.
      continue;
    }

    rows.push({
      skuCode,
      date: dateRaw,
      onHand,
      availEdi: asOptionalInt(r?.availEdi),
      availDsfeed: asOptionalInt(r?.availDsfeed),
    });

    if (dateRaw < earliestDate) earliestDate = dateRaw;
    if (dateRaw > latestDate) latestDate = dateRaw;
    skuSet.add(skuCode);
  }

  return {
    payload: {
      rows,
      locationId: location.id,
      earliestDate: rows.length ? earliestDate : "",
      latestDate: rows.length ? latestDate : "",
      uniqueSkus: skuSet.size,
      unknownSkuCodes: Array.from(unknownSkus),
    },
    rowCount: records.length,
    willImport: rows.length,
    willSkip: unknownSkus.size, // unknown-SKU rows aren't errors, they're skips
    errors,
  };
}

// ---------- writeFromPayload ----------
//
// Delete-and-insert by (sku, location, date range) scope. Idempotent:
// re-running with the same payload yields the same DB state. Snapshots from
// other sources (e.g., wds_inventory STKSTATUS uploads) for SKUs OUTSIDE this
// payload are preserved.

async function writeFromPayload(
  db: PrismaClient,
  batchId: string,
  payload: ParthistDailyPayload,
): Promise<WriteResult> {
  if (payload.rows.length === 0) {
    return { rowsImported: 0, rowsSkipped: 0 };
  }

  const codes = Array.from(new Set(payload.rows.map((r) => r.skuCode)));
  const skus = await db.sku.findMany({
    where: { skuCode: { in: codes } },
    select: { id: true, skuCode: true },
  });
  const skuIdByCode = new Map(skus.map((s) => [s.skuCode, s.id]));

  const skuIds = skus.map((s) => s.id);
  const earliest = new Date(payload.earliestDate);
  const latest = new Date(payload.latestDate);

  let imported = 0;

  await db.$transaction(
    async (tx) => {
      // Wipe the (sku, location, date range) window so re-imports are idempotent.
      // Note: this also wipes any older rows from other importers within the
      // same window — acceptable because parthist-daily is the new authoritative
      // source for daily LOC 1 inventory state.
      await tx.inventorySnapshot.deleteMany({
        where: {
          skuId: { in: skuIds },
          locationId: payload.locationId,
          snapshotDate: { gte: earliest, lte: latest },
        },
      });

      // Bulk insert. createMany is the fastest path; we don't need the IDs back.
      const data = payload.rows
        .map((r) => {
          const skuId = skuIdByCode.get(r.skuCode);
          if (!skuId) return null;
          return {
            skuId,
            locationId: payload.locationId,
            quantityOnHand: r.onHand,
            quantityReserved: 0,
            quantityAvailable: r.onHand, // No reserved field in parthist-daily; treat onHand as available
            snapshotDate: new Date(r.date),
            availEdi: r.availEdi,
            availDsfeed: r.availDsfeed,
            importBatchId: batchId,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (data.length > 0) {
        const result = await tx.inventorySnapshot.createMany({ data });
        imported = result.count;
      }
    },
    { timeout: 60000 },
  );

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: ParthistDailyPayload,
): Promise<DiffSummary> {
  const warnings: GateCheckResult["softFails"] = [];

  if (payload.unknownSkuCodes.length > 0) {
    warnings.push({
      code: "unknown_skus_skipped",
      message: `${payload.unknownSkuCodes.length} SKU(s) in parthist-daily are not in Canopy and will be skipped. These should be backfilled via winpart.json / item update first.`,
      count: payload.unknownSkuCodes.length,
      samples: payload.unknownSkuCodes.slice(0, 10),
    });
  }

  if (payload.rows.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings };
  }

  // For diff, look at the LATEST date in the payload per SKU and compare it
  // against the most recent snapshot in the DB for that SKU at LOC 1.
  // (Comparing every row against history would be expensive and not very useful
  // for the preview UI.)

  const latestPerSku = new Map<string, StagedParthistDailyRow>();
  for (const r of payload.rows) {
    const prior = latestPerSku.get(r.skuCode);
    if (!prior || r.date > prior.date) latestPerSku.set(r.skuCode, r);
  }

  const codes = Array.from(latestPerSku.keys());
  const skus = await db.sku.findMany({
    where: { skuCode: { in: codes } },
    select: { id: true, skuCode: true },
  });
  const idByCode = new Map(skus.map((s) => [s.skuCode, s.id]));
  const skuIds = skus.map((s) => s.id);

  const priors = skuIds.length
    ? await db.inventorySnapshot.findMany({
        where: { skuId: { in: skuIds }, locationId: payload.locationId },
        orderBy: { snapshotDate: "desc" },
        distinct: ["skuId"],
        select: { skuId: true, quantityOnHand: true },
      })
    : [];
  const priorMap = new Map(priors.map((p) => [p.skuId, p.quantityOnHand]));

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  const rowDeltas: RowDelta[] = [];
  let prevTotal = 0;
  let newTotal = 0;

  for (const [skuCode, row] of latestPerSku) {
    newTotal += row.onHand;
    const skuId = idByCode.get(skuCode);
    if (!skuId) {
      // Defensive — should have been filtered in parse
      continue;
    }
    const prior = priorMap.get(skuId);
    if (prior === undefined) {
      newRows++;
      rowDeltas.push({ skuCode, previous: null, next: row.onHand, delta: row.onHand });
    } else {
      prevTotal += prior;
      if (prior === row.onHand) {
        unchangedRows++;
      } else {
        updatedRows++;
        rowDeltas.push({
          skuCode,
          previous: prior,
          next: row.onHand,
          delta: row.onHand - prior,
        });
      }
    }
  }

  // Soft warning: large drop in total LOC 1 on-hand
  if (prevTotal > 0) {
    const swing = ((newTotal - prevTotal) / prevTotal) * 100;
    if (swing <= -20) {
      warnings.push({
        code: "inventory_drop",
        message: `Total Woodinville on-hand drops ${swing.toFixed(0)}% (${prevTotal.toLocaleString()} → ${newTotal.toLocaleString()}) at the latest date in this import.`,
      });
    }
  }

  const topDeltas = [...rowDeltas]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 20);

  return {
    totalStagedRows: payload.rows.length,
    newRows,
    updatedRows,
    unchangedRows,
    topDeltas,
    warnings,
  };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const parthistDailyStaging: ProcessorStagingContract<ParthistDailyPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
