// ============================================================================
// Import Processor: ASIN Mapping (ASIN_SKU_Mapping.xlsx — custpmatrix sheet)
// ============================================================================
// Maps Amazon ASINs to Winsome SKU codes. Also:
//   - Sets isKitParent=true for any SKU flagged KIT in custpmatrix.
//   - Sets isDiEligible=true for any SKU flagged DI=YES in custpmatrix.
//
// Expected columns on the "custpmatrix" sheet:
//   ITEM#, KIT, DI, ASIN, DESCRIPTION
//
// Behavior:
//   - Reads the "custpmatrix" sheet by name; falls back to first sheet if
//     not found.
//   - If an ASIN is already attached to a different SKU, the old mapping is
//     cleared and the ASIN is moved to the new SKU (unique constraint).
//   - Rows missing ITEM# are errored; rows missing ASIN but having a KIT
//     or DI flag still update those bits (a Parent may have no ASIN).
//   - DESCRIPTION is IGNORED on existing SKUs — WDS is the source-of-truth
//     for product names. For newly auto-created SKUs (not yet in WDS), a
//     placeholder name "SKU {itemCode}" is used until WDS import fills it in.
//   - Blank DI/KIT cells are a no-op — we never flip a flag from true to
//     false via this import. Use DB/UI to clear flags.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail } from "./types";
import { parseSpreadsheet } from "./utils";

const TRUTHY = /^(y|yes|x|true|t|1|kit)$/i;

export async function processAsinMapping(
  db: PrismaClient,
  buffer: Buffer,
  batchId: string
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  const { headers, rows } = parseSpreadsheet(buffer, "", {
    headerRow: 0,
    sheetName: "custpmatrix",
  });

  // Resolve header names flexibly
  const findHeader = (regex: RegExp) => headers.find((h) => regex.test(h)) ?? null;
  const itemHeader = findHeader(/^ITEM\s*#?$|^SKU$/i);
  const asinHeader = findHeader(/^ASIN$/i);
  const kitHeader = findHeader(/^KIT$/i);
  const diHeader = findHeader(/^DI$/i);

  if (!itemHeader) {
    errors.push({
      rowNumber: 1,
      fieldName: "headers",
      errorType: "format_error",
      message: `ITEM# column not found on "custpmatrix" sheet. Headers: ${headers.slice(0, 10).join(", ")}`,
    });
    return {
      batchId,
      importType: "asin_mapping",
      fileName: "",
      rowCount: rows.length,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsErrored: 1,
      errors,
    };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const itemCode = row[itemHeader] != null ? String(row[itemHeader]).trim() : "";
    if (!itemCode) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ITEM#",
        errorType: "invalid_value",
        message: "ITEM# is blank",
      });
      continue;
    }

    const asin = asinHeader && row[asinHeader] != null ? String(row[asinHeader]).trim() : "";
    const kitRaw = kitHeader && row[kitHeader] != null ? String(row[kitHeader]).trim() : "";
    const isKit = kitRaw.length > 0 && TRUTHY.test(kitRaw);
    const diRaw = diHeader && row[diHeader] != null ? String(row[diHeader]).trim() : "";
    const isDi = diRaw.length > 0 && TRUTHY.test(diRaw);

    // --- Find SKU ---
    // Auto-create if missing; WDS Inventory may not have been imported yet.
    // Placeholder name "SKU {itemCode}" will be overwritten when WDS imports.
    // We never update `name` from custpmatrix DESCRIPTION on existing SKUs —
    // WDS is source-of-truth for product names.
    let sku = await db.sku.findUnique({
      where: { skuCode: itemCode },
      select: { id: true, isKitComponent: true },
    });
    if (!sku) {
      sku = await db.sku.create({
        data: {
          skuCode: itemCode,
          name: `SKU ${itemCode}`,
          status: "active",
          tier: "C",
        },
        select: { id: true, isKitComponent: true },
      });
    }

    // --- KIT flag handling (blank = no-op, YES = set isKitParent) ---
    if (isKit) {
      if (sku.isKitComponent) {
        // Conflicting roles: the kititems.csv importer marked this SKU as a
        // Component. Don't silently flip it to Parent — surface the conflict.
        errors.push({
          rowNumber: rowNum,
          fieldName: "KIT",
          errorType: "invalid_value",
          message: `SKU "${itemCode}" is already a Kit Component; cannot also be a Kit Parent.`,
          rawValue: kitRaw,
        });
        // Continue with ASIN and DI mapping, but skip the role flip.
      } else {
        await db.sku.update({ where: { id: sku.id }, data: { isKitParent: true } });
      }
    }

    // --- DI flag handling (blank = no-op, YES = set isDiEligible) ---
    if (isDi) {
      await db.sku.update({ where: { id: sku.id }, data: { isDiEligible: true } });
    }

    // --- ASIN mapping ---
    if (!asin) {
      // KIT flag may be the only meaningful update; still count as imported.
      imported++;
      continue;
    }

    const existingAsinOwner = await db.sku.findUnique({ where: { asin } });
    if (existingAsinOwner && existingAsinOwner.id !== sku.id) {
      await db.sku.update({
        where: { id: existingAsinOwner.id },
        data: { asin: null },
      });
    }
    await db.sku.update({ where: { id: sku.id }, data: { asin } });

    imported++;
  }

  return {
    batchId,
    importType: "asin_mapping",
    fileName: "",
    rowCount: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
