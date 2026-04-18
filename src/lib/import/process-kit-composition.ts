// ============================================================================
// Import Processor: Kit Composition (kititems.csv)
// ============================================================================
// Source of truth for Kit bill-of-materials. Positional CSV with:
//   - Col B (index 1) = PARENT#   (Kit Parent SKU code)
//   - Col F (index 5) = CHILD#    (Child SKU code consumed by the kit)
//   - Col H (index 7) = QTY USED  (How many of this Child per 1 Parent)
// All other columns are ignored.
//
// Behavior:
//   - Row 0 is header; data starts at row 1.
//   - For each Parent seen in this file, we "replace" its component list:
//       on first row for that Parent we delete existing kit_components,
//       then every row for that Parent inserts a new kit_component.
//   - Parents NOT in this file are left untouched (overlay semantics).
//   - SKUs are auto-created if missing (no name/vendor info available here;
//     a WDS Inventory import should normally run first to populate names).
//   - A SKU cannot be both a Kit Parent and a Kit Component; attempting to
//     use one as the other raises an error and the row is skipped.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail } from "./types";
import { parseSpreadsheetRaw, toInt } from "./utils";

const COL_PARENT = 1; // B
const COL_CHILD = 5;  // F
const COL_QTY = 7;    // H

export async function processKitComposition(
  db: PrismaClient,
  buffer: Buffer,
  batchId: string
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  const raw = parseSpreadsheetRaw(buffer);
  if (raw.length <= 1) {
    return {
      batchId,
      importType: "kit_composition",
      fileName: "",
      rowCount: 0,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsErrored: 0,
      errors: [],
    };
  }

  // Track which Parents we've already cleared in this batch so we only
  // delete their existing kit_components once.
  const clearedParents = new Set<string>();
  // Cache SKU lookups to avoid repeated DB hits for Parents with many rows.
  const skuCache = new Map<string, { id: string; isKitParent: boolean; isKitComponent: boolean }>();

  async function resolveSku(code: string) {
    if (skuCache.has(code)) return skuCache.get(code)!;
    const existing = await db.sku.findUnique({
      where: { skuCode: code },
      select: { id: true, isKitParent: true, isKitComponent: true },
    });
    if (existing) {
      skuCache.set(code, existing);
      return existing;
    }
    const created = await db.sku.create({
      data: { skuCode: code, name: `SKU ${code}`, status: "active", tier: "C" },
      select: { id: true, isKitParent: true, isKitComponent: true },
    });
    skuCache.set(code, created);
    return created;
  }

  const dataRows = raw.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2; // +2 because row 0 is header

    // Skip fully empty rows silently
    if (!row || row.every((cell) => cell === null || cell === "")) continue;

    const parentRaw = row[COL_PARENT];
    const childRaw = row[COL_CHILD];
    const qtyRaw = row[COL_QTY];

    const parentCode = parentRaw != null ? String(parentRaw).trim() : "";
    const childCode = childRaw != null ? String(childRaw).trim() : "";

    if (!parentCode) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "PARENT#",
        errorType: "invalid_value",
        message: "PARENT# (column B) is blank",
      });
      continue;
    }
    if (!childCode) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "CHILD#",
        errorType: "invalid_value",
        message: "CHILD# (column F) is blank",
        rawValue: parentCode,
      });
      continue;
    }
    if (parentCode === childCode) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "PARENT#/CHILD#",
        errorType: "invalid_value",
        message: `Parent and Child are the same SKU ("${parentCode}") — a kit cannot contain itself`,
        rawValue: parentCode,
      });
      continue;
    }

    const qty = toInt(qtyRaw);
    if (qty === null || qty <= 0) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "QTY USED",
        errorType: "invalid_value",
        message: `QTY USED (column H) must be a positive integer; got "${qtyRaw ?? ""}"`,
        rawValue: qtyRaw != null ? String(qtyRaw) : "",
      });
      continue;
    }

    // Resolve (or create) Parent and Child SKUs
    const parent = await resolveSku(parentCode);
    const child = await resolveSku(childCode);

    // Validate role conflicts
    if (parent.isKitComponent) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "PARENT#",
        errorType: "invalid_value",
        message: `SKU "${parentCode}" is already marked as a Kit Component and cannot also be a Kit Parent`,
        rawValue: parentCode,
      });
      continue;
    }
    if (child.isKitParent) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "CHILD#",
        errorType: "invalid_value",
        message: `SKU "${childCode}" is already marked as a Kit Parent and cannot also be a Kit Component`,
        rawValue: childCode,
      });
      continue;
    }

    // First time we see this Parent in this batch: clear its existing kit
    if (!clearedParents.has(parent.id)) {
      await db.kitComponent.deleteMany({ where: { parentSkuId: parent.id } });
      clearedParents.add(parent.id);
    }

    // Mark SKU roles
    if (!parent.isKitParent) {
      await db.sku.update({ where: { id: parent.id }, data: { isKitParent: true } });
      parent.isKitParent = true;
    }
    if (!child.isKitComponent) {
      await db.sku.update({ where: { id: child.id }, data: { isKitComponent: true } });
      child.isKitComponent = true;
    }

    // Insert kit_component row. Use upsert on (parent, child) in case the
    // same pair appears twice in one file — last qty wins.
    await db.kitComponent.upsert({
      where: {
        unique_kit_pair: { parentSkuId: parent.id, childSkuId: child.id },
      },
      update: { quantityPerKit: qty },
      create: {
        parentSkuId: parent.id,
        childSkuId: child.id,
        quantityPerKit: qty,
      },
    });

    imported++;
  }

  return {
    batchId,
    importType: "kit_composition",
    fileName: "",
    rowCount: dataRows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
