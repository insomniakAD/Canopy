// ============================================================================
// ASIN Mapping — Staging-aware Processor
// ============================================================================
// Maps Amazon ASINs to Winsome SKU codes; also sets isKitParent / isDiEligible.
// Reads from the "custpmatrix" sheet by name (falls back to first sheet).
//
// Payload holds one entry per row: the resolved skuId + what fields need to
// change. Diff reports how many ASIN assignments are new vs updated, plus
// KIT/DI flag changes. No financial deltas — this is a reference-data import.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseSpreadsheet } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
} from "../staging/types";

const TRUTHY = /^(y|yes|x|true|t|1|kit)$/i;

// WDS CSV exports wrap values as ="10115" to prevent Excel auto-formatting.
// Strip that wrapper so we get the bare value regardless of source.
function cleanCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  const m = s.match(/^="(.*)"$/);
  return m ? m[1].trim() : s;
}

// ---------- Payload shape ----------

interface StagedAsinRow {
  skuId: string;
  skuCode: string;
  /** null = no ASIN in this row (KIT/DI-only update) */
  asin: string | null;
  /** null if the ASIN is already on this SKU */
  previousAsinOwnerId: string | null;
  setKitParent: boolean;
  setDiEligible: boolean;
}

export interface AsinMappingPayload {
  rows: StagedAsinRow[];
  /** New SKUs auto-created during parse (not previously in the system) */
  autoCreatedSkuIds: string[];
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<AsinMappingPayload>> {
  const { buffer } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: AsinMappingPayload = { rows: [], autoCreatedSkuIds: [] };

  const { headers, rows } = parseSpreadsheet(buffer, "", {
    headerRow: 0,
    sheetName: "custpmatrix",
  });

  const findHeader = (regex: RegExp) => headers.find((h) => regex.test(h)) ?? null;
  // Matches "ITEM#", "ITEM NUMBER", "ITEM", "SKU" (covers both WDS CSV and custpmatrix sheet)
  const itemHeader = findHeader(/^ITEM(\s*(NUMBER|#))?$|^SKU$/i);
  // Matches "CUSTOMER ITEM#" (WDS CSV col C) and "ASIN" (custpmatrix sheet)
  const asinHeader = findHeader(/^CUSTOMER\s+ITEM#$|^ASIN$/i);
  const kitHeader = findHeader(/^KIT$/i);
  const diHeader = findHeader(/^DI$/i);

  if (!itemHeader) {
    errors.push({
      rowNumber: 1,
      fieldName: "headers",
      errorType: "format_error",
      message: `ITEM# column not found on "custpmatrix" sheet. Headers: ${headers.slice(0, 10).join(", ")}`,
    });
    return { payload, rowCount: rows.length, willImport: 0, willSkip: 0, errors };
  }

  // Pre-fetch all item codes and ASINs from the file
  const itemCodes = rows
    .map((r) => cleanCell(r[itemHeader]))
    .filter(Boolean);
  const fileAsins = asinHeader
    ? rows.map((r) => cleanCell(r[asinHeader])).filter(Boolean)
    : [];

  const [existingSkus, asinOwners] = await Promise.all([
    itemCodes.length
      ? db.sku.findMany({
          where: { skuCode: { in: itemCodes } },
          select: { id: true, skuCode: true, asin: true, isKitComponent: true, isDiEligible: true },
        })
      : [],
    fileAsins.length
      ? db.sku.findMany({
          where: { asin: { in: fileAsins } },
          select: { id: true, asin: true },
        })
      : [],
  ]);

  const skuByCode = new Map(existingSkus.map((s) => [s.skuCode, s]));
  const ownerByAsin = new Map(asinOwners.map((s) => [s.asin!, s.id]));
  let willSkip = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const itemCode = cleanCell(row[itemHeader]);
    if (!itemCode) {
      errors.push({ rowNumber: rowNum, fieldName: "ITEM#", errorType: "invalid_value", message: "ITEM# is blank" });
      continue;
    }

    const asin = asinHeader ? cleanCell(row[asinHeader]) : "";
    const kitRaw = kitHeader ? cleanCell(row[kitHeader]) : "";
    const isKit = kitRaw.length > 0 && TRUTHY.test(kitRaw);
    const diRaw = diHeader ? cleanCell(row[diHeader]) : "";
    const isDi = diRaw.length > 0 && TRUTHY.test(diRaw);

    // Resolve SKU — create placeholder if missing
    let sku = skuByCode.get(itemCode);
    if (!sku) {
      const created = await db.sku.create({
        data: { skuCode: itemCode, name: `SKU ${itemCode}`, status: "active", tier: "C" },
        select: { id: true, skuCode: true, asin: true, isKitComponent: true, isDiEligible: true },
      });
      skuByCode.set(itemCode, created);
      payload.autoCreatedSkuIds.push(created.id);
      sku = created;
    }

    if (isKit && sku.isKitComponent) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "KIT",
        errorType: "invalid_value",
        message: `SKU "${itemCode}" is already a Kit Component; cannot also be a Kit Parent.`,
        rawValue: kitRaw,
      });
      // Continue with ASIN / DI mapping — don't block entire row
    }

    const resolvedAsin = asin || null;
    let previousAsinOwnerId: string | null = null;
    if (resolvedAsin) {
      const existingOwnerId = ownerByAsin.get(resolvedAsin);
      if (existingOwnerId && existingOwnerId !== sku.id) {
        previousAsinOwnerId = existingOwnerId;
      }
    }

    const hasChanges = resolvedAsin || (isKit && !sku.isKitComponent) || (isDi && !sku.isDiEligible);
    if (!hasChanges) {
      willSkip++;
      continue;
    }

    payload.rows.push({
      skuId: sku.id,
      skuCode: sku.skuCode,
      asin: resolvedAsin,
      previousAsinOwnerId,
      setKitParent: isKit && !sku.isKitComponent,
      setDiEligible: isDi && !sku.isDiEligible,
    });
  }

  return { payload, rowCount: rows.length, willImport: payload.rows.length, willSkip, errors };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  _batchId: string,
  payload: AsinMappingPayload
): Promise<WriteResult> {
  let imported = 0;

  await db.$transaction(async (tx) => {
    for (const row of payload.rows) {
      const update: Record<string, unknown> = {};

      if (row.asin) {
        if (row.previousAsinOwnerId) {
          await tx.sku.update({ where: { id: row.previousAsinOwnerId }, data: { asin: null } });
        }
        update.asin = row.asin;
      }
      if (row.setKitParent) update.isKitParent = true;
      if (row.setDiEligible) update.isDiEligible = true;

      if (Object.keys(update).length > 0) {
        await tx.sku.update({ where: { id: row.skuId }, data: update });
      }
      imported++;
    }
  }, { timeout: 30000 });

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  _db: PrismaClient,
  payload: AsinMappingPayload
): Promise<DiffSummary> {
  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;

  for (const row of payload.rows) {
    // "new" = no existing ASIN on this SKU (and we're setting one), or flag-only row
    const isNewAsin = row.asin !== null && row.previousAsinOwnerId === null;
    const isReassigned = row.asin !== null && row.previousAsinOwnerId !== null;
    const isFlagOnly = row.asin === null;

    if (isNewAsin) newRows++;
    else if (isReassigned || isFlagOnly) updatedRows++;
    else unchangedRows++;
  }

  const warnings: GateCheckResult["softFails"] = [];
  if (payload.rows.some((r) => r.previousAsinOwnerId !== null)) {
    const reassigned = payload.rows.filter((r) => r.previousAsinOwnerId !== null).length;
    warnings.push({
      code: "asin_reassignment",
      message: `${reassigned} ASIN(s) will be moved from their current SKU to a different SKU.`,
      count: reassigned,
    });
  }

  if (payload.autoCreatedSkuIds.length > 0) {
    warnings.push({
      code: "auto_created_skus",
      message: `${payload.autoCreatedSkuIds.length} SKU(s) were auto-created as placeholders. Import WDS Inventory to fill in names and vendor data.`,
      count: payload.autoCreatedSkuIds.length,
    });
  }

  return { totalStagedRows: payload.rows.length, newRows, updatedRows, unchangedRows, warnings };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const asinMappingStaging: ProcessorStagingContract<AsinMappingPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
