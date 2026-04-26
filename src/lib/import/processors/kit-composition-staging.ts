// ============================================================================
// Kit Composition — Staging-aware Processor
// ============================================================================
// Source: kititems.csv (positional columns B=PARENT#, F=CHILD#, H=QTY USED).
// Replace-per-parent semantics: on commit the first row for each Parent deletes
// existing KitComponent rows for that Parent, then all rows re-insert.
//
// Payload: parent→children map, ready for commit.
// Diff: parents modified, component rows added vs removed.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseSpreadsheetRaw, toInt } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
} from "../staging/types";

const COL_PARENT = 1; // column B
const COL_CHILD  = 5; // column F
const COL_QTY    = 7; // column H

// ---------- Payload shape ----------

interface StagedKitGroup {
  parentSkuId: string;
  parentSkuCode: string;
  children: { childSkuId: string; childSkuCode: string; quantity: number }[];
}

export interface KitCompositionPayload {
  groups: StagedKitGroup[];
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<KitCompositionPayload>> {
  const { buffer } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: KitCompositionPayload = { groups: [] };

  const raw = parseSpreadsheetRaw(buffer);
  if (raw.length <= 1) {
    return { payload, rowCount: 0, willImport: 0, willSkip: 0, errors };
  }

  const dataRows = raw.slice(1);

  // Collect all codes upfront
  const parentCodes = new Set<string>();
  const childCodes = new Set<string>();
  for (const row of dataRows) {
    if (!row || row.every((c) => c === null || c === "")) continue;
    const p = row[COL_PARENT] != null ? String(row[COL_PARENT]).trim() : "";
    const c = row[COL_CHILD] != null ? String(row[COL_CHILD]).trim() : "";
    if (p) parentCodes.add(p);
    if (c) childCodes.add(c);
  }

  const allCodes = Array.from(new Set([...parentCodes, ...childCodes]));
  const existingSkus = allCodes.length
    ? await db.sku.findMany({
        where: { skuCode: { in: allCodes } },
        select: { id: true, skuCode: true, isKitParent: true, isKitComponent: true },
      })
    : [];

  const skuByCode = new Map(existingSkus.map((s) => [s.skuCode, s]));

  // Auto-create missing SKUs
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

  // Build parent → children map
  type GroupMap = Map<string, { parentId: string; children: { childId: string; childCode: string; qty: number }[] }>;
  const groupMap: GroupMap = new Map();

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2;
    if (!row || row.every((c) => c === null || c === "")) continue;

    const parentCode = row[COL_PARENT] != null ? String(row[COL_PARENT]).trim() : "";
    const childCode = row[COL_CHILD] != null ? String(row[COL_CHILD]).trim() : "";
    const qtyRaw = row[COL_QTY];

    if (!parentCode) {
      errors.push({ rowNumber: rowNum, fieldName: "PARENT#", errorType: "invalid_value", message: "PARENT# (column B) is blank" });
      continue;
    }
    if (!childCode) {
      errors.push({ rowNumber: rowNum, fieldName: "CHILD#", errorType: "invalid_value", message: "CHILD# (column F) is blank", rawValue: parentCode });
      continue;
    }
    if (parentCode === childCode) {
      errors.push({ rowNumber: rowNum, fieldName: "PARENT#/CHILD#", errorType: "invalid_value", message: `Parent and Child are the same SKU ("${parentCode}") — a kit cannot contain itself`, rawValue: parentCode });
      continue;
    }

    const qty = toInt(qtyRaw);
    if (qty === null || qty <= 0) {
      errors.push({ rowNumber: rowNum, fieldName: "QTY USED", errorType: "invalid_value", message: `QTY USED (column H) must be a positive integer; got "${qtyRaw ?? ""}"`, rawValue: qtyRaw != null ? String(qtyRaw) : "" });
      continue;
    }

    const parent = await resolveSku(parentCode);
    const child = await resolveSku(childCode);

    if (parent.isKitComponent) {
      errors.push({ rowNumber: rowNum, fieldName: "PARENT#", errorType: "invalid_value", message: `SKU "${parentCode}" is already marked as a Kit Component and cannot also be a Kit Parent`, rawValue: parentCode });
      continue;
    }
    if (child.isKitParent) {
      errors.push({ rowNumber: rowNum, fieldName: "CHILD#", errorType: "invalid_value", message: `SKU "${childCode}" is already marked as a Kit Parent and cannot also be a Kit Component`, rawValue: childCode });
      continue;
    }

    const group = groupMap.get(parentCode) ?? { parentId: parent.id, children: [] };
    group.children.push({ childId: child.id, childCode, qty });
    groupMap.set(parentCode, group);
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
  return { payload, rowCount: dataRows.length, willImport: totalComponents, willSkip: 0, errors };
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
