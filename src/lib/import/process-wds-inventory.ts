// ============================================================================
// Import Processor: WDS Inventory (STKSTATUS.txt — fixed-width Oracle report)
// ============================================================================
// STKSTATUS.txt is a plain-text, fixed-width report. Expected columns include:
//   ITEM#   SALES DESCRIPTION   VENDOR#   ONHAND   COMMIT   BKORD   ON ORDER
//   QTY AVAIL TO DELIV   NET AVAIL
//
// Math we rely on:
//   QTY AVAIL TO DELIV = ONHAND − COMMIT − BKORD          (available-to-promise)
//   NET AVAIL          = AVAIL TO DELIV + ON ORDER         (projected forward)
//
// What this processor does:
//   1. Parse the text by locating the header and the dashed "ruler" row,
//      deriving exact column boundaries.
//   2. For each data row, extract fields by position.
//   3. Look up (or auto-create) the SKU; update name + vendor code when present.
//   4. Write an InventorySnapshot at Woodinville Warehouse with:
//        quantityOnHand    = ONHAND
//        quantityReserved  = COMMIT + BKORD
//        quantityAvailable = QTY AVAIL TO DELIV
//   5. Amazon Warehouse inventory is NOT loaded here — a separate import
//      (Amazon Vendor Central) supplies that.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail } from "./types";

type ColumnKey =
  | "ITEM"
  | "DESCRIPTION"
  | "VENDOR"
  | "ONHAND"
  | "COMMIT"
  | "BKORD"
  | "ON_ORDER"
  | "AVAIL_TO_DELIV"
  | "NET_AVAIL";

interface ColumnSpec {
  key: ColumnKey;
  /** Regex(es) that the header text for this column might match (case-insensitive). */
  patterns: RegExp[];
  required: boolean;
}

// Order matters: used for greedy left-to-right matching against header tokens.
const COLUMN_SPECS: ColumnSpec[] = [
  { key: "ITEM",           patterns: [/\bITEM\s*#?\b/i],                                   required: true  },
  { key: "DESCRIPTION",    patterns: [/\bSALES\s*DESC/i, /\bDESC/i],                       required: false },
  { key: "VENDOR",         patterns: [/\bVENDOR\s*#?\b/i],                                 required: false },
  { key: "ONHAND",         patterns: [/\bON\s*HAND\b/i, /\bONHAND\b/i],                    required: true  },
  { key: "COMMIT",         patterns: [/\bCOMMIT/i],                                        required: false },
  { key: "BKORD",          patterns: [/\bBK\s*ORD/i, /\bBKORD/i, /\bBACK\s*ORD/i],         required: false },
  { key: "ON_ORDER",       patterns: [/\b(IMPORT\s+)?ON\s*ORD/i, /\bON-ORD/i],             required: false },
  { key: "AVAIL_TO_DELIV", patterns: [/\bAVAIL\s*TO\s*DELIV/i, /\bQTY\s*AVAIL/i],          required: false },
  { key: "NET_AVAIL",      patterns: [/\bNET\s*AVAIL/i],                                   required: false },
];

type ColumnRanges = Partial<Record<ColumnKey, { start: number; end: number }>>;

export async function processWdsInventory(
  db: PrismaClient,
  buffer: Buffer,
  batchId: string,
  snapshotDate: Date
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  // Decode: STKSTATUS is plain ASCII/latin1. utf8 works for 7-bit content.
  const text = buffer.toString("utf8").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");

  // Find the column layout once (first valid header/ruler pair).
  // Also recompute whenever we see a new header (Oracle reports repeat headers each page).
  let ranges: ColumnRanges | null = null;
  let rowCount = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Attempt to detect a header line here. A header has ITEM + ONHAND.
    if (isPotentialHeader(line)) {
      const candidate = deriveRangesFromHeader(line, lines[lineIdx + 1] ?? "");
      if (candidate && candidate.ITEM && candidate.ONHAND) {
        ranges = candidate;
        continue;
      }
    }

    if (!ranges) continue;

    // Skip decorative / blank / totals / form-feed lines
    if (isSkippableLine(line)) continue;

    const itemCode = extractField(line, ranges.ITEM);
    if (!itemCode || !/^[A-Za-z0-9][-A-Za-z0-9._/]*$/.test(itemCode)) {
      // Not a data row
      continue;
    }

    rowCount++;
    const rowNum = lineIdx + 1; // 1-based

    const description = extractField(line, ranges.DESCRIPTION);
    const vendorCode = extractField(line, ranges.VENDOR);
    const onHand = parseIntField(line, ranges.ONHAND);
    const commit = parseIntField(line, ranges.COMMIT) ?? 0;
    const bkord = parseIntField(line, ranges.BKORD) ?? 0;
    const availToDeliv = parseIntField(line, ranges.AVAIL_TO_DELIV);

    if (onHand === null) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ONHAND",
        errorType: "invalid_value",
        message: `ONHAND is not a valid number`,
        rawValue: line.slice(ranges.ONHAND!.start, ranges.ONHAND!.end).trim(),
      });
      continue;
    }

    // Prefer the reported QTY AVAIL TO DELIV when present; otherwise derive.
    const reserved = commit + bkord;
    const available = availToDeliv !== null ? availToDeliv : Math.max(0, onHand - reserved);

    // --- Find or create SKU ---
    let sku = await db.sku.findUnique({ where: { skuCode: itemCode } });
    if (!sku) {
      sku = await db.sku.create({
        data: {
          skuCode: itemCode,
          name: description && description.length > 0 ? description : `SKU ${itemCode}`,
          vendorCode: vendorCode || null,
          status: "active",
          tier: "C",
        },
      });
    } else {
      const updates: { name?: string; vendorCode?: string } = {};
      if (description) updates.name = description;
      if (vendorCode) updates.vendorCode = vendorCode;
      if (Object.keys(updates).length > 0) {
        await db.sku.update({ where: { id: sku.id }, data: updates });
      }
    }

    // --- Snapshot at Woodinville Warehouse ---
    const location = await db.inventoryLocation.findFirst({
      where: { name: "Woodinville Warehouse" },
    });
    if (!location) {
      throw new Error("Woodinville Warehouse location not found. Run seed first.");
    }

    await db.inventorySnapshot.create({
      data: {
        skuId: sku.id,
        locationId: location.id,
        quantityOnHand: onHand,
        quantityReserved: reserved,
        quantityAvailable: available,
        snapshotDate,
        importBatchId: batchId,
      },
    });

    imported++;
  }

  return {
    batchId,
    importType: "wds_inventory",
    fileName: "",
    rowCount,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}

// ----- Layout detection helpers -----

function isPotentialHeader(line: string): boolean {
  if (!/\bITEM\s*#?\b/i.test(line)) return false;
  return /\bON\s*HAND\b|\bONHAND\b/i.test(line);
}

/**
 * Given a header line (e.g. "  ITEM#   SALES DESCRIPTION   VENDOR#   ONHAND   COMMIT   ...")
 * and optionally a dashed ruler line that follows it, return column ranges.
 *
 * Strategy:
 *   1. If a dashed ruler line follows the header, use its dash-groups as
 *      authoritative column widths, then label each group by the header text
 *      above it.
 *   2. Otherwise, find each column spec's pattern position in the header,
 *      and infer column end = next column's start.
 */
function deriveRangesFromHeader(headerLine: string, nextLine: string): ColumnRanges | null {
  const rulerGroups = parseDashRuler(nextLine);

  if (rulerGroups && rulerGroups.length >= 2) {
    // Use the ruler widths. Map each group to a column by the header text above it.
    const ranges: ColumnRanges = {};
    for (let g = 0; g < rulerGroups.length; g++) {
      const grp = rulerGroups[g];
      const nextGrpStart = g + 1 < rulerGroups.length ? rulerGroups[g + 1].start : headerLine.length + 50;
      // Header text for this group spans up to the next group's start
      const headerSegment = headerLine.slice(grp.start, nextGrpStart);
      const key = classifyHeaderSegment(headerSegment);
      if (key && !ranges[key]) {
        ranges[key] = { start: grp.start, end: nextGrpStart };
      }
    }
    return ranges;
  }

  // Fall back: locate each known header pattern in the header line directly.
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
    if (!ranges[found[i].key]) {
      ranges[found[i].key] = { start: found[i].start, end };
    }
  }
  return ranges;
}

function parseDashRuler(line: string): { start: number; end: number }[] | null {
  if (!line || !/-/.test(line)) return null;
  // Ruler lines are almost entirely dashes and spaces
  const nonDashNonSpace = line.replace(/[-\s]/g, "");
  if (nonDashNonSpace.length > 0) return null;

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

// ----- Row parsing helpers -----

function isSkippableLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (/^[-=_\s]+$/.test(trimmed)) return true;               // separators/rulers
  if (/^\f/.test(line)) return true;                          // form feed
  if (/\bSTKSTATUS\b/i.test(trimmed)) return true;            // report title line
  if (/\bPAGE\s*\d/i.test(trimmed)) return true;              // page number footer
  if (/\bDATE\s*[:]/i.test(trimmed) && trimmed.length < 60) return true; // header date
  if (/\bTOTAL\b/i.test(trimmed)) return true;                // subtotals
  if (/\bEND\s+OF\s+REPORT\b/i.test(trimmed)) return true;
  return false;
}

function extractField(line: string, range?: { start: number; end: number }): string {
  if (!range) return "";
  if (range.start >= line.length) return "";
  const end = Math.min(range.end, line.length);
  return line.slice(range.start, end).trim();
}

function parseIntField(line: string, range?: { start: number; end: number }): number | null {
  const raw = extractField(line, range);
  if (!raw) return null;
  const cleaned = raw.replace(/[,$]/g, "").replace(/^\((.*)\)$/, "-$1"); // (123) → -123
  const n = Number(cleaned);
  if (!isFinite(n) || !Number.isInteger(n)) {
    // Allow decimals by rounding only if it's a pure-numeric value
    const f = parseFloat(cleaned);
    if (!isFinite(f)) return null;
    return Math.round(f);
  }
  return n;
}
