// ============================================================================
// Kit Composition — Staging-aware Processor
// ============================================================================
// Source: WDS KITITEMS.txt — a fixed-width Oracle text report.
// Replace-per-parent semantics: on commit the first row for each Parent deletes
// existing KitComponent rows for that Parent, then all rows re-insert.
//
// Fixed-width layout (derived from the PARENT#/CHILD# header line):
//   PARENT#  cols ~2-8   (only present on first row of each kit group)
//   CHILD#   cols ~65-71 (present on every component row)
//   QTY USED rightmost token on each data line
//
// The report paginates; each page repeats the DATE/PROG/USER/header block.
// Non-data lines are identified by the absence of a numeric code in the
// PARENT# or CHILD# column.
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
} from "../staging/types";

// ---------- Payload shape ----------

interface StagedKitGroup {
  parentSkuId: string;
  parentSkuCode: string;
  children: { childSkuId: string; childSkuCode: string; quantity: number }[];
}

export interface KitCompositionPayload {
  groups: StagedKitGroup[];
}

// Returns true for the "where used" section header (CHILD# appears before PARENT#).
// This marks the boundary between section 1 (kit compositions) and section 2 (component usage).
function isSection2Header(line: string): boolean {
  if (!line.includes("CHILD#") || !line.includes("PARENT#")) return false;
  return line.indexOf("CHILD#") < line.indexOf("PARENT#");
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<KitCompositionPayload>> {
  const { buffer } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: KitCompositionPayload = { groups: [] };

  const lines = buffer.toString("utf8").split(/\r?\n/);

  // Locate the PARENT#/CHILD# column header — use it to derive exact field positions.
  // The report repeats this header on every page; only the first occurrence is needed.
  let parentStart = -1;
  let childStart = -1;
  let dataStartIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("PARENT#") && lines[i].includes("CHILD#")) {
      parentStart = lines[i].indexOf("PARENT#");
      childStart = lines[i].indexOf("CHILD#");
      // Data begins after the dash separator that immediately follows.
      dataStartIdx = i + 1;
      if (dataStartIdx < lines.length && /\s*-{5}/.test(lines[dataStartIdx])) {
        dataStartIdx++;
      }
      break;
    }
  }

  if (parentStart === -1 || dataStartIdx === -1) {
    errors.push({
      rowNumber: 1,
      fieldName: "header",
      errorType: "format_error",
      message: 'Could not find "PARENT#" / "CHILD#" header. Expected WDS KITITEMS.txt report format.',
    });
    return { payload, rowCount: 0, willImport: 0, willSkip: 0, errors };
  }

  // First pass — collect all SKU codes for a single batch DB lookup.
  // Stop at the section-2 boundary (header where CHILD# precedes PARENT#).
  const parentCodes = new Set<string>();
  const childCodes = new Set<string>();

  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (isSection2Header(line)) break;
    if (line.length <= childStart) continue;
    const p = line.slice(parentStart, parentStart + 7).trim();
    const c = line.slice(childStart, childStart + 7).trim();
    if (p && /^\d+$/.test(p)) parentCodes.add(p);
    if (c && /^\d+$/.test(c)) childCodes.add(c);
  }

  const allCodes = Array.from(new Set([...parentCodes, ...childCodes]));
  const existingSkus = allCodes.length
    ? await db.sku.findMany({
        where: { skuCode: { in: allCodes } },
        select: { id: true, skuCode: true, isKitParent: true, isKitComponent: true },
      })
    : [];
  const skuByCode = new Map(existingSkus.map((s) => [s.skuCode, s]));

  // Auto-create missing SKUs (e.g. components not yet in WDS Active Items).
  async function resolveSku(code: string) {
    const existing = skuByCode.get(code);
    if (existing) return existing;
    const created = await db.sku.create({
      data: { skuCode: code, name: `SKU ${code}`, status: "active", tier: "C" },
      select: { id: true, skuCode: true, isKitParent: true, isKitComponent: true },
    });
    skuByCode.set(code, created);
    return created;
  }

  // Second pass — build the parent→children map.
  type GroupMap = Map<string, { parentId: string; children: { childId: string; childCode: string; qty: number }[] }>;
  const groupMap: GroupMap = new Map();
  let currentParent = "";
  let dataRowCount = 0;

  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Section 2 starts when the header flips to CHILD# … PARENT#. Stop here.
    if (isSection2Header(line)) break;

    // Extract raw values from fixed-width positions.
    const parentRaw = line.length > parentStart + 7 ? line.slice(parentStart, parentStart + 7).trim() : "";
    const childRaw  = line.length > childStart  + 7 ? line.slice(childStart,  childStart  + 7).trim() : "";

    // Non-numeric at parent/child position = page header repeat or blank — skip.
    const parentIsCode = /^\d+$/.test(parentRaw);
    const childIsCode  = /^\d+$/.test(childRaw);
    if (!parentIsCode && !childIsCode) continue;

    if (parentIsCode) currentParent = parentRaw;
    if (!currentParent || !childIsCode) continue;

    // QTY is always the rightmost token on the line.
    const qtyStr = line.trimEnd().split(/\s+/).pop() ?? "";
    const qty = parseInt(qtyStr, 10);
    const rowNum = i + 1;
    dataRowCount++;

    if (!qty || qty <= 0) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "QTY USED",
        errorType: "invalid_value",
        message: `QTY USED must be a positive integer; got "${qtyStr}" (parent ${currentParent}, child ${childRaw})`,
        rawValue: qtyStr,
      });
      continue;
    }
    if (currentParent === childRaw) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "PARENT#/CHILD#",
        errorType: "invalid_value",
        message: `Parent and Child are the same SKU ("${currentParent}") — a kit cannot contain itself`,
        rawValue: currentParent,
      });
      continue;
    }

    const parent = await resolveSku(currentParent);
    const child  = await resolveSku(childRaw);

    if (parent.isKitComponent) {
      errors.push({ rowNumber: rowNum, fieldName: "PARENT#", errorType: "invalid_value", message: `SKU "${currentParent}" is a Kit Component and cannot also be a Kit Parent`, rawValue: currentParent });
      continue;
    }
    if (child.isKitParent) {
      errors.push({ rowNumber: rowNum, fieldName: "CHILD#", errorType: "invalid_value", message: `SKU "${childRaw}" is a Kit Parent and cannot also be a Kit Component`, rawValue: childRaw });
      continue;
    }

    const group = groupMap.get(currentParent) ?? { parentId: parent.id, children: [] };
    group.children.push({ childId: child.id, childCode: childRaw, qty });
    groupMap.set(currentParent, group);
  }

  for (const [parentCode, group] of groupMap) {
    payload.groups.push({
      parentSkuId: group.parentId,
      parentSkuCode: parentCode,
      children: group.children.map((c) => ({
        childSkuId: c.childId,
        childSkuCode: c.childCode,
        quantity: c.qty,
      })),
    });
  }

  const totalComponents = payload.groups.reduce((s, g) => s + g.children.length, 0);
  return { payload, rowCount: dataRowCount, willImport: totalComponents, willSkip: 0, errors };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  _batchId: string,
  payload: KitCompositionPayload
): Promise<WriteResult> {
  let imported = 0;

  await db.$transaction(async (tx) => {
    for (const group of payload.groups) {
      // Replace all components for this parent
      await tx.kitComponent.deleteMany({ where: { parentSkuId: group.parentSkuId } });

      for (const child of group.children) {
        await tx.kitComponent.upsert({
          where: { unique_kit_pair: { parentSkuId: group.parentSkuId, childSkuId: child.childSkuId } },
          update: { quantityPerKit: child.quantity },
          create: { parentSkuId: group.parentSkuId, childSkuId: child.childSkuId, quantityPerKit: child.quantity },
        });
        imported++;
      }

      await tx.sku.update({ where: { id: group.parentSkuId }, data: { isKitParent: true } });
      await tx.sku.updateMany({
        where: { id: { in: group.children.map((c) => c.childSkuId) } },
        data: { isKitComponent: true },
      });
    }
  }, { timeout: 30000 });

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: KitCompositionPayload
): Promise<DiffSummary> {
  if (payload.groups.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings: [] };
  }

  const parentIds = payload.groups.map((g) => g.parentSkuId);
  const existingComponents = await db.kitComponent.findMany({
    where: { parentSkuId: { in: parentIds } },
    select: { parentSkuId: true, childSkuId: true, quantityPerKit: true },
  });

  const existingByParent = new Map<string, Map<string, number>>();
  for (const ec of existingComponents) {
    const m = existingByParent.get(ec.parentSkuId) ?? new Map<string, number>();
    m.set(ec.childSkuId, ec.quantityPerKit);
    existingByParent.set(ec.parentSkuId, m);
  }

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  let parentsModified = 0;

  const totalStagedRows = payload.groups.reduce((s, g) => s + g.children.length, 0);

  for (const group of payload.groups) {
    const priorChildren = existingByParent.get(group.parentSkuId) ?? new Map<string, number>();
    let groupChanged = false;

    for (const child of group.children) {
      const priorQty = priorChildren.get(child.childSkuId);
      if (priorQty === undefined) {
        newRows++;
        groupChanged = true;
      } else if (priorQty !== child.quantity) {
        updatedRows++;
        groupChanged = true;
      } else {
        unchangedRows++;
      }
    }

    // Check for removed children (in prior but not in new)
    for (const [priorChildId] of priorChildren) {
      if (!group.children.some((c) => c.childSkuId === priorChildId)) {
        updatedRows++;
        groupChanged = true;
      }
    }

    if (groupChanged) parentsModified++;
  }

  const warnings: GateCheckResult["softFails"] = [];
  if (parentsModified > 0) {
    warnings.push({
      code: "kit_parents_replaced",
      message: `${parentsModified} kit parent(s) will have their component list fully replaced.`,
      count: parentsModified,
    });
  }

  return { totalStagedRows, newRows, updatedRows, unchangedRows, warnings };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const kitCompositionStaging: ProcessorStagingContract<KitCompositionPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
