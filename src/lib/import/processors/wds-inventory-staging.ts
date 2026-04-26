// ============================================================================
// WDS Inventory — Staging-aware Processor
// ============================================================================
// Source: STKSTATUS.txt (fixed-width Oracle report).
// One InventorySnapshot per SKU at Woodinville Warehouse per import.
// Also creates/updates the SKU record itself (name, vendorCode).
//
// Parse re-implements the column detection and row extraction from
// process-wds-inventory.ts so commit becomes a simple loop.
// Diff: new vs updated snapshots, total on-hand delta.
// Soft warning: >20% drop in total on-hand.
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

// ---------- Column detection (mirrors process-wds-inventory.ts) ----------

type ColumnKey =
  | "ITEM"
  | "DESCRIPTION"
  | "VENDOR"
  | "ONHAND"
  | "COMMIT"
  | "BKORD"
  | "AVAIL_TO_DELIV";

const COLUMN_SPECS: {
  key: ColumnKey;
  patterns: RegExp[];
  required: boolean;
}[] = [
  { key: "ITEM",           patterns: [/\bITEM\s*#?\b/i],                             required: true  },
  { key: "DESCRIPTION",    patterns: [/\bSALES\s*DESC/i, /\bDESC/i],                 required: false },
  { key: "VENDOR",         patterns: [/\bVENDOR\s*#?\b/i],                           required: false },
  { key: "ONHAND",         patterns: [/\bON\s*HAND\b/i, /\bONHAND\b/i],              required: true  },
  { key: "COMMIT",         patterns: [/\bCOMMIT/i],                                  required: false },
  { key: "BKORD",          patterns: [/\bBK\s*ORD/i, /\bBKORD/i, /\bBACK\s*ORD/i],  required: false },
  { key: "AVAIL_TO_DELIV", patterns: [/\bAVAIL\s*TO\s*DELIV/i, /\bQTY\s*AVAIL/i],   required: false },
];

type ColumnRanges = Partial<Record<ColumnKey, { start: number; end: number }>>;

function isPotentialHeader(line: string): boolean {
  return /\bITEM\s*#?\b/i.test(line) && /\bON\s*HAND\b|\bONHAND\b/i.test(line);
}

function parseDashRuler(line: string): { start: number; end: number }[] | null {
  if (!line || !/-/.test(line)) return null;
  if (line.replace(/[-\s]/g, "").length > 0) return null;
  const groups: { start: number; end: number }[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "-") {
      const start = i;
      while (i < line.length && line[i] === "-") i++;
      groups.push({ start, end: i });
    } else {
      i++;
    }
  }
  return groups.length >= 2 ? groups : null;
}

function classifyHeaderSegment(segment: string): ColumnKey | null {
  for (const spec of COLUMN_SPECS) {
    for (const pattern of spec.patterns) {
      if (pattern.test(segment)) return spec.key;
    }
  }
  return null;
}

function deriveRanges(headerLine: string, nextLine: string): ColumnRanges | null {
  const rulerGroups = parseDashRuler(nextLine);
  if (rulerGroups && rulerGroups.length >= 2) {
    const ranges: ColumnRanges = {};
    for (let g = 0; g < rulerGroups.length; g++) {
      const grp = rulerGroups[g];
      const nextStart = g + 1 < rulerGroups.length ? rulerGroups[g + 1].start : headerLine.length + 50;
      const key = classifyHeaderSegment(headerLine.slice(grp.start, nextStart));
      if (key && !ranges[key]) ranges[key] = { start: grp.start, end: nextStart };
    }
    return ranges;
  }
  const found: { key: ColumnKey; start: number }[] = [];
  for (const spec of COLUMN_SPECS) {
    for (const pattern of spec.patterns) {
      const m = headerLine.match(pattern);
      if (m && m.index !== undefined) {
        found.push({ key: spec.key, start: m.index });
        break;
      }
    }
  }
  if (found.length < 2) return null;
  found.sort((a, b) => a.start - b.start);
  const ranges: ColumnRanges = {};
  for (let i = 0; i < found.length; i++) {
    const end = i + 1 < found.length ? found[i + 1].start : headerLine.length + 50;
    if (!ranges[found[i].key]) ranges[found[i].key] = { start: found[i].start, end };
  }
  return ranges;
}

function extractField(line: string, range?: { start: number; end: number }): string {
  if (!range) return "";
  if (range.start >= line.length) return "";
  return line.slice(range.start, Math.min(range.end, line.length)).trim();
}

function parseIntField(line: string, range?: { start: number; end: number }): number | null {
  const raw = extractField(line, range);
  if (!raw) return null;
  const cleaned = raw.replace(/[,$]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  if (!isFinite(n)) {
    const f = parseFloat(cleaned);
    return isFinite(f) ? Math.round(f) : null;
  }
  return Number.isInteger(n) ? n : Math.round(n);
}

function isSkippableLine(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return true;
  if (/^[-=_\s]+$/.test(t)) return true;
  if (/^\f/.test(line)) return true;
  if (/\bSTKSTATUS\b/i.test(t)) return true;
  if (/\bPAGE\s*\d/i.test(t)) return true;
  if (/\bDATE\s*[:]/i.test(t) && t.length < 60) return true;
  if (/\bTOTAL\b/i.test(t)) return true;
  if (/\bEND\s+OF\s+REPORT\b/i.test(t)) return true;
  return false;
}

// ---------- Payload shape ----------

interface StagedWdsInventoryRow {
  skuCode: string;
  name: string;
  vendorCode: string | null;
  onHand: number;
  reserved: number;
  available: number;
}

export interface WdsInventoryPayload {
  rows: StagedWdsInventoryRow[];
  snapshotDate: string;
  locationId: string;
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<WdsInventoryPayload>> {
  const { buffer, today } = input;
  const errors: ImportErrorDetail[] = [];

  const location = await db.inventoryLocation.findFirst({ where: { name: "Woodinville Warehouse" } });
  if (!location) throw new Error("Woodinville Warehouse location not found. Run seed first.");

  const payload: WdsInventoryPayload = {
    rows: [],
    snapshotDate: today.toISOString(),
    locationId: location.id,
  };

  const text = buffer.toString("utf8").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  let ranges: ColumnRanges | null = null;
  let rowCount = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (isPotentialHeader(line)) {
      const candidate = deriveRanges(line, lines[lineIdx + 1] ?? "");
      if (candidate?.ITEM && candidate.ONHAND) {
        ranges = candidate;
        continue;
      }
    }
    if (!ranges) continue;
    if (isSkippableLine(line)) continue;

    const itemCode = extractField(line, ranges.ITEM);
    if (!itemCode || !/^[A-Za-z0-9][-A-Za-z0-9._/]*$/.test(itemCode)) continue;

    rowCount++;
    const rowNum = lineIdx + 1;

    const description = extractField(line, ranges.DESCRIPTION);
    const vendorCode = extractField(line, ranges.VENDOR) || null;
    const onHand = parseIntField(line, ranges.ONHAND);

    if (onHand === null) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ONHAND",
        errorType: "invalid_value",
        message: "ONHAND is not a valid number",
        rawValue: extractField(line, ranges.ONHAND),
      });
      continue;
    }

    const commit = parseIntField(line, ranges.COMMIT) ?? 0;
    const bkord = parseIntField(line, ranges.BKORD) ?? 0;
    const availToDeliv = parseIntField(line, ranges.AVAIL_TO_DELIV);
    const reserved = commit + bkord;
    const available = availToDeliv !== null ? availToDeliv : Math.max(0, onHand - reserved);

    payload.rows.push({
      skuCode: itemCode,
      name: description && description.length > 0 ? description : `SKU ${itemCode}`,
      vendorCode,
      onHand,
      reserved,
      available,
    });
  }

  return { payload, rowCount, willImport: payload.rows.length, willSkip: 0, errors };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  batchId: string,
  payload: WdsInventoryPayload
): Promise<WriteResult> {
  const snapshotDate = new Date(payload.snapshotDate);
  const codes = payload.rows.map((r) => r.skuCode);

  // Pre-fetch existing SKUs outside the transaction so no reads happen inside it.
  const existingSkus = codes.length
    ? await db.sku.findMany({ where: { skuCode: { in: codes } }, select: { id: true, skuCode: true } })
    : [];
  const skuIdByCode = new Map(existingSkus.map((s) => [s.skuCode, s.id]));

  let imported = 0;

  await db.$transaction(
    async (tx) => {
      for (const row of payload.rows) {
        let skuId = skuIdByCode.get(row.skuCode);

        if (!skuId) {
          const created = await tx.sku.create({
            data: { skuCode: row.skuCode, name: row.name, vendorCode: row.vendorCode, status: "active", tier: "C" },
            select: { id: true },
          });
          skuId = created.id;
          skuIdByCode.set(row.skuCode, skuId);
        } else {
          const updates: { name?: string; vendorCode?: string } = {};
          if (row.name) updates.name = row.name;
          if (row.vendorCode) updates.vendorCode = row.vendorCode;
          if (Object.keys(updates).length > 0) {
            await tx.sku.update({ where: { skuCode: row.skuCode }, data: updates });
          }
        }

        await tx.inventorySnapshot.create({
          data: {
            skuId,
            locationId: payload.locationId,
            quantityOnHand: row.onHand,
            quantityReserved: row.reserved,
            quantityAvailable: row.available,
            snapshotDate,
            importBatchId: batchId,
          },
        });

        imported++;
      }
    },
    { timeout: 30000 }
  );

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: WdsInventoryPayload
): Promise<DiffSummary> {
  if (payload.rows.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings: [] };
  }

  const codes = payload.rows.map((r) => r.skuCode);
  const skuRecords = await db.sku.findMany({
    where: { skuCode: { in: codes } },
    select: { id: true, skuCode: true },
  });
  const idByCode = new Map(skuRecords.map((s) => [s.skuCode, s.id]));

  const skuIds = skuRecords.map((s) => s.id);

  // Most-recent snapshot per SKU at Woodinville
  const latestSnapshots = skuIds.length
    ? await db.inventorySnapshot.findMany({
        where: { skuId: { in: skuIds }, locationId: payload.locationId },
        orderBy: { snapshotDate: "desc" },
        distinct: ["skuId"],
        select: { skuId: true, quantityOnHand: true },
      })
    : [];
  const priorMap = new Map(latestSnapshots.map((s) => [s.skuId, s.quantityOnHand]));

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  const rowDeltas: RowDelta[] = [];
  let prevTotal = 0;
  let newTotal = 0;

  for (const row of payload.rows) {
    const skuId = idByCode.get(row.skuCode);
    newTotal += row.onHand;
    if (!skuId) {
      // SKU doesn't exist yet — will be created on commit
      newRows++;
      rowDeltas.push({ skuCode: row.skuCode, previous: null, next: row.onHand, delta: row.onHand });
      continue;
    }
    const prior = priorMap.get(skuId);
    if (prior === undefined) {
      newRows++;
      rowDeltas.push({ skuCode: row.skuCode, previous: null, next: row.onHand, delta: row.onHand });
    } else {
      prevTotal += prior;
      if (prior === row.onHand) {
        unchangedRows++;
      } else {
        updatedRows++;
        rowDeltas.push({ skuCode: row.skuCode, previous: prior, next: row.onHand, delta: row.onHand - prior });
      }
    }
  }

  const topDeltas = [...rowDeltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);
  const warnings: GateCheckResult["softFails"] = [];

  if (prevTotal > 0) {
    const swing = ((newTotal - prevTotal) / prevTotal) * 100;
    if (swing <= -20) {
      warnings.push({
        code: "inventory_drop",
        message: `Total Woodinville on-hand drops ${swing.toFixed(0)}% (${prevTotal.toLocaleString()} → ${newTotal.toLocaleString()}).`,
      });
    }
  }

  return { totalStagedRows: payload.rows.length, newRows, updatedRows, unchangedRows, topDeltas, warnings };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const wdsInventoryStaging: ProcessorStagingContract<WdsInventoryPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
