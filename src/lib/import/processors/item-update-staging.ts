// ============================================================================
// Item Update — Staging-aware Processor
// ============================================================================
// Three sheets processed in order:
//   1. Vendors  — upsert Factory (vendorCode, name, country)
//   2. Items    — update SKU fields; detect vendor change → pending_transition
//   3. Kits     — replace KitComponent rows per parent
//
// Payload captures all three sheets' changes so commit is a straight apply loop.
// Diff: vendors upserted, items updated, kit parents replaced, transitions created.
// ============================================================================

import type { PrismaClient, Country, SkuStatus, SkuTier } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseSpreadsheet, toNumber, toInt } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
} from "../staging/types";

const YES = /^(y|yes|true|t|1)$/i;
const NO = /^(n|no|false|f|0)$/i;
const VALID_COUNTRIES: Country[] = ["china", "malaysia", "thailand", "indonesia"];
const VALID_STATUS: SkuStatus[] = ["active", "discontinued", "seasonal"];
const VALID_TIERS: SkuTier[] = ["A", "B", "C", "LP"];

function cell(row: Record<string, unknown>, key: string | null): string {
  if (!key) return "";
  const v = row[key];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function findHeader(headers: string[], regex: RegExp): string | null {
  return headers.find((h) => regex.test(h)) ?? null;
}

// ---------- Payload shape ----------

interface StagedVendorRow {
  vendorCode: string;
  name: string | null;
  country: Country | null;
  isNew: boolean;
}

interface StagedItemRow {
  skuId: string;
  skuCode: string;
  updates: Record<string, unknown>;
  /** If set, a pending_vendor_transition should be written instead of defaultFactoryId */
  vendorTransition: {
    existingPendingId: string | null;
    fromFactoryId: string | null;
    toFactoryId: string;
    newVendorCode: string;
    newUnitCost: number | null;
    newMoq: number | null;
    newFclQty40GP: number | null;
    newFclQty40HQ: number | null;
  } | null;
}

interface StagedKitGroup {
  parentSkuId: string;
  parentSkuCode: string;
  children: { childSkuId: string; childSkuCode: string; quantity: number }[];
}

export interface ItemUpdatePayload {
  vendors: StagedVendorRow[];
  items: StagedItemRow[];
  kitGroups: StagedKitGroup[];
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<ItemUpdatePayload>> {
  const { buffer } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: ItemUpdatePayload = { vendors: [], items: [], kitGroups: [] };
  let totalRows = 0;
  let willSkip = 0;

  // ---- Sheet 1: Vendors ----
  try {
    const { headers, rows } = parseSpreadsheet(buffer, "", { headerRow: 0, sheetName: "Vendors" });
    totalRows += rows.length;

    const vCodeH = findHeader(headers, /^VENDOR\s*#?$/i);
    const vNameH = findHeader(headers, /^VENDOR\s*NAME$/i);
    const vCountryH = findHeader(headers, /COUNTRY/i);

    if (!vCodeH) {
      errors.push({ rowNumber: 1, fieldName: "Vendors/VENDOR#", errorType: "format_error", message: `Vendors sheet: VENDOR# column not found. Headers: ${headers.join(", ")}` });
    } else {
      // Pre-fetch existing factories
      const codes = rows.map((r) => cell(r, vCodeH)).filter((c) => /^[\w\-]+$/.test(c));
      const existingFactories = codes.length
        ? await db.factory.findMany({ where: { vendorCode: { in: codes } }, select: { id: true, vendorCode: true } })
        : [];
      const existingByCode = new Set(existingFactories.map((f) => f.vendorCode));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const vendorCode = cell(row, vCodeH);
        if (!vendorCode || !/^[\w\-]+$/.test(vendorCode)) { willSkip++; continue; }

        const name = cell(row, vNameH) || null;
        const countryRaw = cell(row, vCountryH).toLowerCase();
        let country: Country | null = null;
        if (countryRaw) {
          const match = VALID_COUNTRIES.find((c) => c === countryRaw);
          if (!match) {
            errors.push({ rowNumber: rowNum, fieldName: "Vendors/COUNTRY OF ORIGIN", errorType: "invalid_value", message: `Unknown country "${countryRaw}". Valid: ${VALID_COUNTRIES.join(", ")}`, rawValue: countryRaw });
            continue;
          }
          country = match;
        }
        payload.vendors.push({ vendorCode, name, country, isNew: !existingByCode.has(vendorCode) });
      }
    }
  } catch (e) {
    errors.push({ rowNumber: 0, fieldName: "Vendors", errorType: "format_error", message: `Vendors sheet missing or unreadable: ${e instanceof Error ? e.message : String(e)}` });
  }

  // ---- Sheet 2: Items ----
  try {
    const { headers, rows } = parseSpreadsheet(buffer, "", { headerRow: 0, sheetName: "Items" });
    totalRows += rows.length;

    const itemH   = findHeader(headers, /^ITEM\s*#?$/i);
    const nameH   = findHeader(headers, /^ITEM\s*NAME$/i);
    const statusH = findHeader(headers, /^STATUS$/i);
    const asinH   = findHeader(headers, /^ASIN$/i);
    const diH     = findHeader(headers, /^DI\s*ENROLLED$/i);
    const kitH    = findHeader(headers, /^KIT\s*PARENT$/i);
    const vendorH = findHeader(headers, /^VENDOR\s*#?$/i);
    const fclGpH  = findHeader(headers, /FCL.*40\s*GP/i);
    const fclHqH  = findHeader(headers, /FCL.*40\s*HQ/i);
    const moqH    = findHeader(headers, /^MOQ$/i);
    const costH   = findHeader(headers, /UNIT\s*COST/i);
    const tierH   = findHeader(headers, /TIER/i);

    if (!itemH) {
      errors.push({ rowNumber: 1, fieldName: "Items/ITEM#", errorType: "format_error", message: `Items sheet: ITEM# column not found. Headers: ${headers.join(", ")}` });
    } else {
      // Pre-fetch all item codes
      const itemCodes = rows
        .map((r) => cell(r, itemH))
        .filter((c) => /^[\w\-]+$/.test(c));
      const skuRecords = itemCodes.length
        ? await db.sku.findMany({
            where: { skuCode: { in: itemCodes } },
            include: { defaultFactory: { select: { id: true, vendorCode: true } } },
          })
        : [];
      const skuByCode = new Map(skuRecords.map((s) => [s.skuCode, s]));

      // Pre-fetch all vendor codes mentioned in Items sheet
      const newVendorCodes = rows
        .map((r) => cell(r, vendorH))
        .filter(Boolean);
      const factories = newVendorCodes.length
        ? await db.factory.findMany({ where: { vendorCode: { in: newVendorCodes } }, select: { id: true, vendorCode: true } })
        : [];
      const factoryByCode = new Map(factories.map((f) => [f.vendorCode, f]));

      // Pre-fetch pending transitions for affected SKUs
      const skuIds = skuRecords.map((s) => s.id);
      const pendingTransitions = skuIds.length
        ? await db.pendingVendorTransition.findMany({
            where: { skuId: { in: skuIds }, status: "pending" },
            select: { id: true, skuId: true },
          })
        : [];
      const pendingBySkuId = new Map(pendingTransitions.map((t) => [t.skuId, t.id]));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const itemCode = cell(row, itemH);
        if (!itemCode || !/^[\w\-]+$/.test(itemCode)) { willSkip++; continue; }

        const sku = skuByCode.get(itemCode);
        if (!sku) {
          errors.push({ rowNumber: rowNum, fieldName: "Items/ITEM#", errorType: "missing_sku", message: `SKU "${itemCode}" not found. Import WDS inventory or ASIN mapping first.`, rawValue: itemCode });
          continue;
        }

        const updates: Record<string, unknown> = {};

        const newName = cell(row, nameH);
        if (newName) updates.name = newName;

        const statusRaw = cell(row, statusH).toLowerCase();
        if (statusRaw) {
          const match = VALID_STATUS.find((s) => s === statusRaw);
          if (!match) {
            errors.push({ rowNumber: rowNum, fieldName: "Items/STATUS", errorType: "invalid_value", message: `Unknown status "${statusRaw}". Valid: ${VALID_STATUS.join(", ")}`, rawValue: statusRaw });
          } else {
            updates.status = match;
          }
        }

        const asinRaw = cell(row, asinH);
        if (asinRaw) updates.asin = asinRaw;

        const diRaw = cell(row, diH);
        if (diRaw) {
          if (YES.test(diRaw)) updates.isDiEligible = true;
          else if (NO.test(diRaw)) updates.isDiEligible = false;
          else errors.push({ rowNumber: rowNum, fieldName: "Items/DI ENROLLED", errorType: "invalid_value", message: "Expected YES or NO", rawValue: diRaw });
        }

        const kitRaw = cell(row, kitH);
        if (kitRaw) {
          if (YES.test(kitRaw)) {
            if (sku.isKitComponent) {
              errors.push({ rowNumber: rowNum, fieldName: "Items/KIT PARENT", errorType: "invalid_value", message: `"${itemCode}" is already a Kit Component and cannot also be a Kit Parent.`, rawValue: kitRaw });
            } else {
              updates.isKitParent = true;
            }
          } else if (NO.test(kitRaw)) {
            updates.isKitParent = false;
          } else {
            errors.push({ rowNumber: rowNum, fieldName: "Items/KIT PARENT", errorType: "invalid_value", message: "Expected YES or NO", rawValue: kitRaw });
          }
        }

        const tierRaw = cell(row, tierH).toUpperCase();
        if (tierRaw) {
          const match = VALID_TIERS.find((t) => t === tierRaw);
          if (!match) {
            errors.push({ rowNumber: rowNum, fieldName: "Items/TIER OVERRIDE", errorType: "invalid_value", message: `Unknown tier "${tierRaw}". Valid: ${VALID_TIERS.join(", ")}`, rawValue: tierRaw });
          } else {
            updates.tier = match;
          }
        }

        const newVendorCode = cell(row, vendorH);
        const newUnitCost = toNumber(cell(row, costH));
        const newMoq = toInt(cell(row, moqH));
        const newFclGp = toInt(cell(row, fclGpH));
        const newFclHq = toInt(cell(row, fclHqH));

        let vendorTransition: StagedItemRow["vendorTransition"] = null;

        if (newVendorCode) {
          const newFactory = factoryByCode.get(newVendorCode);
          if (!newFactory) {
            errors.push({ rowNumber: rowNum, fieldName: "Items/VENDOR#", errorType: "invalid_value", message: `Vendor "${newVendorCode}" not found. Add it on the Vendors sheet first.`, rawValue: newVendorCode });
          } else {
            const currentVendorCode = sku.defaultFactory?.vendorCode ?? null;
            if (!currentVendorCode) {
              updates.defaultFactoryId = newFactory.id;
            } else if (currentVendorCode === newVendorCode) {
              // Same vendor — apply cost/MOQ/FCL directly below
            } else {
              // Vendor change → pending transition
              vendorTransition = {
                existingPendingId: pendingBySkuId.get(sku.id) ?? null,
                fromFactoryId: sku.defaultFactoryId,
                toFactoryId: newFactory.id,
                newVendorCode,
                newUnitCost,
                newMoq,
                newFclQty40GP: newFclGp,
                newFclQty40HQ: newFclHq,
              };
            }
          }
        }

        if (!vendorTransition) {
          if (newUnitCost !== null) updates.unitCostUsd = newUnitCost;
          if (newMoq !== null) updates.moq = newMoq;
          if (newFclGp !== null) updates.fclQty40GP = newFclGp;
          if (newFclHq !== null) updates.fclQty40HQ = newFclHq;
        }

        if (Object.keys(updates).length > 0 || vendorTransition) {
          payload.items.push({ skuId: sku.id, skuCode: itemCode, updates, vendorTransition });
        } else {
          willSkip++;
        }
      }
    }
  } catch (e) {
    errors.push({ rowNumber: 0, fieldName: "Items", errorType: "format_error", message: `Items sheet missing or unreadable: ${e instanceof Error ? e.message : String(e)}` });
  }

  // ---- Sheet 3: Kits ----
  try {
    const { headers, rows } = parseSpreadsheet(buffer, "", { headerRow: 0, sheetName: "Kits" });
    totalRows += rows.length;

    const parentH = findHeader(headers, /^PARENT\s*ITEM\s*#?$/i);
    const childH  = findHeader(headers, /^CHILD\s*ITEM\s*#?$/i);
    const qtyH    = findHeader(headers, /^QTY/i);

    if (rows.length > 0 && (!parentH || !childH || !qtyH)) {
      errors.push({ rowNumber: 1, fieldName: "Kits/headers", errorType: "format_error", message: `Kits sheet: required columns PARENT ITEM#, CHILD ITEM#, QTY PER KIT. Headers: ${headers.join(", ")}` });
    } else if (parentH && childH && qtyH) {
      // Collect codes
      const parentCodes = new Set<string>();
      const childCodes = new Set<string>();
      for (const row of rows) {
        const p = cell(row, parentH);
        const c = cell(row, childH);
        if (p && /^[\w\-]+$/.test(p)) parentCodes.add(p);
        if (c && /^[\w\-]+$/.test(c)) childCodes.add(c);
      }
      const allCodes = Array.from(new Set([...parentCodes, ...childCodes]));
      const kitSkus = allCodes.length
        ? await db.sku.findMany({ where: { skuCode: { in: allCodes } }, select: { id: true, skuCode: true } })
        : [];
      const kitSkuByCode = new Map(kitSkus.map((s) => [s.skuCode, s.id]));

      // Group by parent
      const byParent = new Map<string, { child: string; qty: number; rowNum: number }[]>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const parentCode = cell(row, parentH);
        const childCode = cell(row, childH);
        const qty = toInt(cell(row, qtyH));
        if (!parentCode || !childCode) { if (parentCode || childCode) willSkip++; continue; }
        if (!/^[\w\-]+$/.test(parentCode) || !/^[\w\-]+$/.test(childCode)) { willSkip++; continue; }
        if (qty === null || qty <= 0) {
          errors.push({ rowNumber: rowNum, fieldName: "Kits/QTY PER KIT", errorType: "invalid_value", message: "QTY PER KIT must be a positive integer", rawValue: cell(row, qtyH) });
          continue;
        }
        const list = byParent.get(parentCode) ?? [];
        list.push({ child: childCode, qty, rowNum });
        byParent.set(parentCode, list);
      }

      for (const [parentCode, components] of byParent) {
        const parentId = kitSkuByCode.get(parentCode);
        if (!parentId) {
          errors.push({ rowNumber: components[0].rowNum, fieldName: "Kits/PARENT ITEM#", errorType: "missing_sku", message: `Parent SKU "${parentCode}" not found.`, rawValue: parentCode });
          continue;
        }
        const resolved: { childSkuId: string; childSkuCode: string; quantity: number }[] = [];
        let blocked = false;
        for (const c of components) {
          const childId = kitSkuByCode.get(c.child);
          if (!childId) {
            errors.push({ rowNumber: c.rowNum, fieldName: "Kits/CHILD ITEM#", errorType: "missing_sku", message: `Child SKU "${c.child}" not found (parent "${parentCode}").`, rawValue: c.child });
            blocked = true;
            continue;
          }
          if (childId === parentId) {
            errors.push({ rowNumber: c.rowNum, fieldName: "Kits/CHILD ITEM#", errorType: "invalid_value", message: `Kit parent "${parentCode}" cannot be its own child.` });
            blocked = true;
            continue;
          }
          resolved.push({ childSkuId: childId, childSkuCode: c.child, quantity: c.qty });
        }
        if (!blocked && resolved.length > 0) {
          payload.kitGroups.push({ parentSkuId: parentId, parentSkuCode: parentCode, children: resolved });
        }
      }
    }
  } catch (e) {
    errors.push({ rowNumber: 0, fieldName: "Kits", errorType: "format_error", message: `Kits sheet missing or unreadable: ${e instanceof Error ? e.message : String(e)}` });
  }

  const willImport = payload.vendors.length + payload.items.length +
    payload.kitGroups.reduce((s, g) => s + g.children.length, 0);

  return { payload, rowCount: totalRows, willImport, willSkip, errors };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  _batchId: string,
  payload: ItemUpdatePayload
): Promise<WriteResult> {
  let imported = 0;

  await db.$transaction(async (tx) => {
    // Vendors
    for (const v of payload.vendors) {
      const existing = await tx.factory.findUnique({ where: { vendorCode: v.vendorCode } });
      if (!existing) {
        await tx.factory.create({ data: { vendorCode: v.vendorCode, name: v.name || `Vendor ${v.vendorCode}`, country: v.country } });
      } else {
        const update: { name?: string; country?: Country } = {};
        if (v.name) update.name = v.name;
        if (v.country) update.country = v.country;
        if (Object.keys(update).length > 0) await tx.factory.update({ where: { id: existing.id }, data: update });
      }
      imported++;
    }

    // Items
    for (const item of payload.items) {
      if (item.vendorTransition) {
        const vt = item.vendorTransition;
        const transitionData = {
          skuId: item.skuId,
          newVendorCode: vt.newVendorCode,
          fromFactoryId: vt.fromFactoryId,
          toFactoryId: vt.toFactoryId,
          newUnitCost: vt.newUnitCost ?? undefined,
          newMoq: vt.newMoq ?? undefined,
          newFclQty40GP: vt.newFclQty40GP ?? undefined,
          newFclQty40HQ: vt.newFclQty40HQ ?? undefined,
          status: "pending" as const,
        };
        if (vt.existingPendingId) {
          await tx.pendingVendorTransition.update({ where: { id: vt.existingPendingId }, data: transitionData });
        } else {
          await tx.pendingVendorTransition.create({ data: transitionData });
        }
      }
      if (Object.keys(item.updates).length > 0) {
        // Handle ASIN conflict: if moving an ASIN to this SKU, clear it from prior owner
        if (item.updates.asin) {
          const existingOwner = await tx.sku.findUnique({ where: { asin: item.updates.asin as string } });
          if (existingOwner && existingOwner.id !== item.skuId) {
            await tx.sku.update({ where: { id: existingOwner.id }, data: { asin: null } });
          }
        }
        await tx.sku.update({ where: { id: item.skuId }, data: item.updates });
      }
      imported++;
    }

    // Kit Groups
    for (const group of payload.kitGroups) {
      await tx.kitComponent.deleteMany({ where: { parentSkuId: group.parentSkuId } });
      for (const child of group.children) {
        await tx.kitComponent.create({
          data: { parentSkuId: group.parentSkuId, childSkuId: child.childSkuId, quantityPerKit: child.quantity },
        });
        imported++;
      }
      await tx.sku.update({ where: { id: group.parentSkuId }, data: { isKitParent: true } });
      await tx.sku.updateMany({
        where: { id: { in: group.children.map((c) => c.childSkuId) } },
        data: { isKitComponent: true },
      });
    }
  });

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  _db: PrismaClient,
  payload: ItemUpdatePayload
): Promise<DiffSummary> {
  const totalStagedRows =
    payload.vendors.length +
    payload.items.length +
    payload.kitGroups.reduce((s, g) => s + g.children.length, 0);

  const newRows = payload.vendors.filter((v) => v.isNew).length;
  const updatedRows = payload.vendors.filter((v) => !v.isNew).length + payload.items.length;
  const unchangedRows = 0;

  const warnings: GateCheckResult["softFails"] = [];

  const transitionCount = payload.items.filter((i) => i.vendorTransition !== null).length;
  if (transitionCount > 0) {
    warnings.push({
      code: "vendor_transitions_queued",
      message: `${transitionCount} vendor transition(s) will be queued as pending (take effect when the first matching PO arrives).`,
      count: transitionCount,
    });
  }

  const kitParentsReplaced = payload.kitGroups.length;
  if (kitParentsReplaced > 0) {
    warnings.push({
      code: "kit_parents_replaced",
      message: `${kitParentsReplaced} kit parent(s) will have their component list fully replaced.`,
      count: kitParentsReplaced,
    });
  }

  const asinChanges = payload.items.filter((i) => i.updates.asin).length;
  if (asinChanges > 0) {
    warnings.push({
      code: "asin_updates",
      message: `${asinChanges} item(s) will have their ASIN updated. Any conflicting ASIN assignments will be cleared from their current SKU.`,
      count: asinChanges,
    });
  }

  return { totalStagedRows, newRows, updatedRows, unchangedRows, warnings };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const itemUpdateStaging: ProcessorStagingContract<ItemUpdatePayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
