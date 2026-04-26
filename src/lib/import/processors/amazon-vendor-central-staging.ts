// ============================================================================
// Amazon Vendor Central — Staging-aware Processor
// ============================================================================
// One InventorySnapshot per ASIN at "Amazon FC" (NATIONAL region only).
// Diff compares sellable on-hand units vs the most recent snapshot per SKU.
// Soft warning: >20% total on-hand drop across all staged SKUs.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { toInt } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
  RowDelta,
} from "../staging/types";

const NATIONAL_REGION = "NATIONAL";

// ---------- Payload shape ----------

interface StagedVCRow {
  skuId: string;
  skuCode: string;
  sellable: number;
  unsellable: number;
}

export interface AmazonVendorCentralPayload {
  rows: StagedVCRow[];
  snapshotDate: string;
  locationId: string;
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<AmazonVendorCentralPayload>> {
  const { rows, today } = input;
  const errors: ImportErrorDetail[] = [];

  const location = await db.inventoryLocation.findFirst({ where: { name: "Amazon FC" } });
  if (!location) {
    throw new Error('"Amazon FC" inventory location not found. Run seed or migration.');
  }

  const payload: AmazonVendorCentralPayload = {
    rows: [],
    snapshotDate: today.toISOString(),
    locationId: location.id,
  };

  // Collect all ASINs from NATIONAL rows upfront
  const nationalRows = rows.filter(
    (r) => (r["Region"] != null ? String(r["Region"]).trim() : "") === NATIONAL_REGION
  );

  const asins = nationalRows
    .map((r) => (r["ASIN"] != null ? String(r["ASIN"]).trim() : ""))
    .filter(Boolean);

  const skuRecords = asins.length
    ? await db.sku.findMany({
        where: { asin: { in: asins } },
        select: { id: true, skuCode: true, asin: true },
      })
    : [];
  const skuByAsin = new Map(skuRecords.map((s) => [s.asin!, { id: s.id, code: s.skuCode }]));
  const seenAsins = new Set<string>();

  let willSkip = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const region = row["Region"] != null ? String(row["Region"]).trim() : "";
    if (region !== NATIONAL_REGION) {
      willSkip++;
      continue;
    }

    const asin = row["ASIN"] != null ? String(row["ASIN"]).trim() : "";
    if (!asin) {
      errors.push({ rowNumber: rowNum, fieldName: "ASIN", errorType: "invalid_value", message: "ASIN is blank" });
      continue;
    }
    if (seenAsins.has(asin)) {
      willSkip++;
      continue;
    }
    seenAsins.add(asin);

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

    const sellable = Math.max(0, toInt(row["On-hand_Sellable"]) ?? 0);
    const unsellable = Math.max(0, toInt(row["On-hand_Unsellable"]) ?? 0);

    payload.rows.push({ skuId: skuInfo.id, skuCode: skuInfo.code, sellable, unsellable });
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
  payload: AmazonVendorCentralPayload
): Promise<WriteResult> {
  const snapshotDate = new Date(payload.snapshotDate);
  let imported = 0;

  await db.$transaction(async (tx) => {
    for (const row of payload.rows) {
      await tx.inventorySnapshot.create({
        data: {
          skuId: row.skuId,
          locationId: payload.locationId,
          quantityOnHand: row.sellable,
          quantityReserved: row.unsellable,
          quantityAvailable: row.sellable,
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
  payload: AmazonVendorCentralPayload
): Promise<DiffSummary> {
  if (payload.rows.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings: [] };
  }

  const skuIds = payload.rows.map((r) => r.skuId);

  // Most-recent snapshot per SKU at Amazon FC
  const latestSnapshots = await db.inventorySnapshot.findMany({
    where: { skuId: { in: skuIds }, locationId: payload.locationId },
    orderBy: { snapshotDate: "desc" },
    distinct: ["skuId"],
    select: { skuId: true, quantityOnHand: true },
  });
  const priorMap = new Map(latestSnapshots.map((s) => [s.skuId, s.quantityOnHand]));

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  const rowDeltas: RowDelta[] = [];
  let prevTotal = 0;
  let newTotal = 0;

  for (const row of payload.rows) {
    const prior = priorMap.get(row.skuId);
    newTotal += row.sellable;
    if (prior === undefined) {
      newRows++;
      rowDeltas.push({ skuCode: row.skuCode, previous: null, next: row.sellable, delta: row.sellable });
    } else {
      prevTotal += prior;
      if (prior === row.sellable) {
        unchangedRows++;
      } else {
        updatedRows++;
        rowDeltas.push({ skuCode: row.skuCode, previous: prior, next: row.sellable, delta: row.sellable - prior });
      }
    }
  }

  const topDeltas = [...rowDeltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);
  const warnings: GateCheckResult["softFails"] = [];

  if (prevTotal > 0) {
    const swing = ((newTotal - prevTotal) / prevTotal) * 100;
    if (swing <= -20) {
      warnings.push({
        code: "amazon_inventory_drop",
        message: `Total Amazon FC sellable on-hand drops ${swing.toFixed(0)}% (${prevTotal.toLocaleString()} → ${newTotal.toLocaleString()}).`,
      });
    }
  }

  return { totalStagedRows: payload.rows.length, newRows, updatedRows, unchangedRows, topDeltas, warnings };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const amazonVendorCentralStaging: ProcessorStagingContract<AmazonVendorCentralPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
