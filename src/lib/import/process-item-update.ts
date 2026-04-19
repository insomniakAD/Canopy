// ============================================================================
// Import Processor: Item Update (ItemUpdateTemplate.xlsx)
// ============================================================================
// Three sheets, processed in order:
//   1. Vendors  — VENDOR#, VENDOR NAME, COUNTRY OF ORIGIN
//                 Upsert Factory by vendorCode. Name/country update if provided.
//   2. Items    — ITEM#, ITEM NAME, STATUS, ASIN, DI ENROLLED, KIT PARENT,
//                 VENDOR#, FCL QTY 40GP, FCL QTY 40HQ, MOQ, UNIT COST (USD),
//                 TIER OVERRIDE
//                 Blank cell = no-op (leave existing value).
//                 If VENDOR# differs from current default factory's vendorCode,
//                 write a pending_vendor_transitions row instead of mutating
//                 Sku.defaultFactoryId. In that row, also capture the new
//                 unit cost / MOQ / FCL quantities if those cells were
//                 provided — they belong to the new vendor and must not
//                 overwrite current production values.
//   3. Kits     — PARENT ITEM#, CHILD ITEM#, QTY PER KIT
//                 Replaces KitComponent rows for each parent encountered.
//                 Sets isKitParent=true on parent, isKitComponent=true on child.
//
// Notes:
//   - The template never clears fields. Use the UI/DB to wipe values.
//   - STATUS accepts active/discontinued/seasonal (case-insensitive).
//   - TIER OVERRIDE accepts A/B/C/LP (case-insensitive) → sku.tier.
//   - DI ENROLLED / KIT PARENT accept YES/NO (blank = no-op).
//   - Kit Parent's COUNTRY OF ORIGIN lives on its vendor's Factory row —
//     assign the anchor child's vendor to the Parent SKU upstream of this
//     importer, or leave the Parent without a factory.
// ============================================================================

import type { PrismaClient, Country, SkuStatus, SkuTier } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail } from "./types";
import { parseSpreadsheet, toNumber, toInt } from "./utils";

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

export async function processItemUpdate(
  db: PrismaClient,
  buffer: Buffer,
  batchId: string
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;
  let totalRows = 0;

  // ----- Sheet 1: Vendors -----
  let vendorRes: { parsed: number; errorsBefore: number } = {
    parsed: 0,
    errorsBefore: errors.length,
  };
  try {
    const { headers, rows } = parseSpreadsheet(buffer, "", {
      headerRow: 0,
      sheetName: "Vendors",
    });
    vendorRes.parsed = rows.length;
    totalRows += rows.length;

    const vCodeH = findHeader(headers, /^VENDOR\s*#?$/i);
    const vNameH = findHeader(headers, /^VENDOR\s*NAME$/i);
    const vCountryH = findHeader(headers, /COUNTRY/i);

    if (!vCodeH) {
      errors.push({
        rowNumber: 1,
        fieldName: "Vendors/VENDOR#",
        errorType: "format_error",
        message: `Vendors sheet: VENDOR# column not found. Headers: ${headers.join(", ")}`,
      });
    } else {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const vendorCode = cell(row, vCodeH);
        if (!vendorCode) {
          skipped++;
          continue;
        }
        // Skip the gray italic instruction row (row 2) — vendor codes are
        // short alphanumerics, so any whitespace or punctuation flags a
        // format hint like "Enter WDS vendor code (e.g. HRN)".
        if (!/^[\w\-]+$/.test(vendorCode)) {
          skipped++;
          continue;
        }
        const name = cell(row, vNameH);
        const countryRaw = cell(row, vCountryH).toLowerCase();
        let country: Country | null = null;
        if (countryRaw) {
          const match = VALID_COUNTRIES.find((c) => c === countryRaw);
          if (!match) {
            errors.push({
              rowNumber: rowNum,
              fieldName: "Vendors/COUNTRY OF ORIGIN",
              errorType: "invalid_value",
              message: `Unknown country "${countryRaw}". Valid: ${VALID_COUNTRIES.join(", ")}`,
              rawValue: countryRaw,
            });
            continue;
          }
          country = match;
        }

        const existing = await db.factory.findUnique({ where: { vendorCode } });
        if (!existing) {
          await db.factory.create({
            data: {
              vendorCode,
              name: name || `Vendor ${vendorCode}`,
              country,
            },
          });
        } else {
          const update: { name?: string; country?: Country } = {};
          if (name) update.name = name;
          if (country) update.country = country;
          if (Object.keys(update).length > 0) {
            await db.factory.update({ where: { id: existing.id }, data: update });
          }
        }
        imported++;
      }
    }
  } catch (e) {
    errors.push({
      rowNumber: 0,
      fieldName: "Vendors",
      errorType: "format_error",
      message: `Vendors sheet missing or unreadable: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // ----- Sheet 2: Items -----
  try {
    const { headers, rows } = parseSpreadsheet(buffer, "", {
      headerRow: 0,
      sheetName: "Items",
    });
    totalRows += rows.length;

    const itemH = findHeader(headers, /^ITEM\s*#?$/i);
    const nameH = findHeader(headers, /^ITEM\s*NAME$/i);
    const statusH = findHeader(headers, /^STATUS$/i);
    const asinH = findHeader(headers, /^ASIN$/i);
    const diH = findHeader(headers, /^DI\s*ENROLLED$/i);
    const kitH = findHeader(headers, /^KIT\s*PARENT$/i);
    const vendorH = findHeader(headers, /^VENDOR\s*#?$/i);
    const fclGpH = findHeader(headers, /FCL.*40\s*GP/i);
    const fclHqH = findHeader(headers, /FCL.*40\s*HQ/i);
    const moqH = findHeader(headers, /^MOQ$/i);
    const unitCostH = findHeader(headers, /UNIT\s*COST/i);
    const tierH = findHeader(headers, /TIER/i);

    if (!itemH) {
      errors.push({
        rowNumber: 1,
        fieldName: "Items/ITEM#",
        errorType: "format_error",
        message: `Items sheet: ITEM# column not found. Headers: ${headers.join(", ")}`,
      });
    } else {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const itemCode = cell(row, itemH);
        if (!itemCode) {
          skipped++;
          continue;
        }
        // Skip the description/format row under the header (row 2), which
        // typically explains formats like "YES/NO" or "Decimal". We heuristically
        // detect by checking whether ITEM# looks numeric.
        if (!/^[\w\-]+$/.test(itemCode)) {
          skipped++;
          continue;
        }

        const sku = await db.sku.findUnique({
          where: { skuCode: itemCode },
          include: { defaultFactory: true },
        });
        if (!sku) {
          errors.push({
            rowNumber: rowNum,
            fieldName: "Items/ITEM#",
            errorType: "missing_sku",
            message: `SKU "${itemCode}" not found. Import WDS inventory or ASIN mapping first.`,
            rawValue: itemCode,
          });
          continue;
        }

        // Collect direct Sku updates (non-vendor fields).
        const update: Record<string, unknown> = {};

        const newName = cell(row, nameH);
        if (newName) update.name = newName;

        const statusRaw = cell(row, statusH).toLowerCase();
        if (statusRaw) {
          const match = VALID_STATUS.find((s) => s === statusRaw);
          if (!match) {
            errors.push({
              rowNumber: rowNum,
              fieldName: "Items/STATUS",
              errorType: "invalid_value",
              message: `Unknown status "${statusRaw}". Valid: ${VALID_STATUS.join(", ")}`,
              rawValue: statusRaw,
            });
          } else {
            update.status = match;
          }
        }

        const asinRaw = cell(row, asinH);
        if (asinRaw) {
          const existingOwner = await db.sku.findUnique({ where: { asin: asinRaw } });
          if (existingOwner && existingOwner.id !== sku.id) {
            await db.sku.update({ where: { id: existingOwner.id }, data: { asin: null } });
          }
          update.asin = asinRaw;
        }

        const diRaw = cell(row, diH);
        if (diRaw) {
          if (YES.test(diRaw)) update.isDiEligible = true;
          else if (NO.test(diRaw)) update.isDiEligible = false;
          else {
            errors.push({
              rowNumber: rowNum,
              fieldName: "Items/DI ENROLLED",
              errorType: "invalid_value",
              message: `Expected YES or NO`,
              rawValue: diRaw,
            });
          }
        }

        const kitRaw = cell(row, kitH);
        if (kitRaw) {
          if (YES.test(kitRaw)) {
            if (sku.isKitComponent) {
              errors.push({
                rowNumber: rowNum,
                fieldName: "Items/KIT PARENT",
                errorType: "invalid_value",
                message: `"${itemCode}" is already a Kit Component and cannot also be a Kit Parent.`,
                rawValue: kitRaw,
              });
            } else {
              update.isKitParent = true;
            }
          } else if (NO.test(kitRaw)) {
            update.isKitParent = false;
          } else {
            errors.push({
              rowNumber: rowNum,
              fieldName: "Items/KIT PARENT",
              errorType: "invalid_value",
              message: `Expected YES or NO`,
              rawValue: kitRaw,
            });
          }
        }

        const tierRaw = cell(row, tierH).toUpperCase();
        if (tierRaw) {
          const match = VALID_TIERS.find((t) => t === tierRaw);
          if (!match) {
            errors.push({
              rowNumber: rowNum,
              fieldName: "Items/TIER OVERRIDE",
              errorType: "invalid_value",
              message: `Unknown tier "${tierRaw}". Valid: ${VALID_TIERS.join(", ")}`,
              rawValue: tierRaw,
            });
          } else {
            update.tier = match;
          }
        }

        // --- Vendor / transition handling ---
        const newVendorCode = cell(row, vendorH);
        const newUnitCost = toNumber(cell(row, unitCostH));
        const newMoq = toInt(cell(row, moqH));
        const newFclGp = toInt(cell(row, fclGpH));
        const newFclHq = toInt(cell(row, fclHqH));

        let isTransition = false;
        if (newVendorCode) {
          const newFactory = await db.factory.findUnique({ where: { vendorCode: newVendorCode } });
          if (!newFactory) {
            errors.push({
              rowNumber: rowNum,
              fieldName: "Items/VENDOR#",
              errorType: "invalid_value",
              message: `Vendor "${newVendorCode}" not found. Add it on the Vendors sheet first.`,
              rawValue: newVendorCode,
            });
          } else {
            const currentVendorCode = sku.defaultFactory?.vendorCode ?? null;
            if (!currentVendorCode) {
              // No prior vendor — set it directly. This is first assignment, not a transition.
              update.defaultFactoryId = newFactory.id;
            } else if (currentVendorCode === newVendorCode) {
              // Same vendor — apply cost/MOQ/FCL fields directly.
            } else {
              // Vendor change → record as pending transition, do NOT mutate Sku.
              isTransition = true;
              const existingPending = await db.pendingVendorTransition.findFirst({
                where: { skuId: sku.id, status: "pending" },
              });
              const transitionData = {
                skuId: sku.id,
                newVendorCode,
                fromFactoryId: sku.defaultFactoryId,
                toFactoryId: newFactory.id,
                newUnitCost: newUnitCost ?? undefined,
                newMoq: newMoq ?? undefined,
                newFclQty40GP: newFclGp ?? undefined,
                newFclQty40HQ: newFclHq ?? undefined,
                status: "pending" as const,
              };
              if (existingPending) {
                await db.pendingVendorTransition.update({
                  where: { id: existingPending.id },
                  data: transitionData,
                });
              } else {
                await db.pendingVendorTransition.create({ data: transitionData });
              }
            }
          }
        }

        if (!isTransition) {
          if (newUnitCost !== null) update.unitCostUsd = newUnitCost;
          if (newMoq !== null) update.moq = newMoq;
          if (newFclGp !== null) update.fclQty40GP = newFclGp;
          if (newFclHq !== null) update.fclQty40HQ = newFclHq;
        }

        if (Object.keys(update).length > 0) {
          await db.sku.update({ where: { id: sku.id }, data: update });
        }
        imported++;
      }
    }
  } catch (e) {
    errors.push({
      rowNumber: 0,
      fieldName: "Items",
      errorType: "format_error",
      message: `Items sheet missing or unreadable: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // ----- Sheet 3: Kits -----
  try {
    const { headers, rows } = parseSpreadsheet(buffer, "", {
      headerRow: 0,
      sheetName: "Kits",
    });
    totalRows += rows.length;

    const parentH = findHeader(headers, /^PARENT\s*ITEM\s*#?$/i);
    const childH = findHeader(headers, /^CHILD\s*ITEM\s*#?$/i);
    const qtyH = findHeader(headers, /^QTY/i);

    if (rows.length > 0 && (!parentH || !childH || !qtyH)) {
      errors.push({
        rowNumber: 1,
        fieldName: "Kits/headers",
        errorType: "format_error",
        message: `Kits sheet: required columns PARENT ITEM#, CHILD ITEM#, QTY PER KIT. Headers: ${headers.join(", ")}`,
      });
    } else if (parentH && childH && qtyH) {
      // Group by parent so each parent's components are replaced in one batch.
      const byParent = new Map<string, { child: string; qty: number; rowNum: number }[]>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const parentCode = cell(row, parentH);
        const childCode = cell(row, childH);
        const qty = toInt(cell(row, qtyH));
        if (!parentCode || !childCode) {
          if (parentCode || childCode) skipped++;
          continue;
        }
        // Skip the gray italic instruction row — SKU codes are short
        // alphanumerics, so any whitespace or punctuation flags a format hint.
        if (!/^[\w\-]+$/.test(parentCode) || !/^[\w\-]+$/.test(childCode)) {
          skipped++;
          continue;
        }
        if (qty === null || qty <= 0) {
          errors.push({
            rowNumber: rowNum,
            fieldName: "Kits/QTY PER KIT",
            errorType: "invalid_value",
            message: `QTY PER KIT must be a positive integer`,
            rawValue: cell(row, qtyH),
          });
          continue;
        }
        const list = byParent.get(parentCode) ?? [];
        list.push({ child: childCode, qty, rowNum });
        byParent.set(parentCode, list);
      }

      for (const [parentCode, components] of byParent) {
        const parent = await db.sku.findUnique({ where: { skuCode: parentCode } });
        if (!parent) {
          errors.push({
            rowNumber: components[0].rowNum,
            fieldName: "Kits/PARENT ITEM#",
            errorType: "missing_sku",
            message: `Parent SKU "${parentCode}" not found.`,
            rawValue: parentCode,
          });
          continue;
        }
        // Resolve all child SKUs first; skip this parent entirely if any child is missing.
        const resolved: { childId: string; qty: number }[] = [];
        let blocked = false;
        for (const c of components) {
          const child = await db.sku.findUnique({ where: { skuCode: c.child } });
          if (!child) {
            errors.push({
              rowNumber: c.rowNum,
              fieldName: "Kits/CHILD ITEM#",
              errorType: "missing_sku",
              message: `Child SKU "${c.child}" not found (parent "${parentCode}").`,
              rawValue: c.child,
            });
            blocked = true;
            continue;
          }
          if (child.id === parent.id) {
            errors.push({
              rowNumber: c.rowNum,
              fieldName: "Kits/CHILD ITEM#",
              errorType: "invalid_value",
              message: `Kit parent "${parentCode}" cannot be its own child.`,
            });
            blocked = true;
            continue;
          }
          resolved.push({ childId: child.id, qty: c.qty });
        }
        if (blocked) continue;

        await db.kitComponent.deleteMany({ where: { parentSkuId: parent.id } });
        for (const r of resolved) {
          await db.kitComponent.create({
            data: { parentSkuId: parent.id, childSkuId: r.childId, quantityPerKit: r.qty },
          });
        }
        await db.sku.update({ where: { id: parent.id }, data: { isKitParent: true } });
        await db.sku.updateMany({
          where: { id: { in: resolved.map((r) => r.childId) } },
          data: { isKitComponent: true },
        });
        imported += resolved.length;
      }
    }
  } catch (e) {
    errors.push({
      rowNumber: 0,
      fieldName: "Kits",
      errorType: "format_error",
      message: `Kits sheet missing or unreadable: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  return {
    batchId,
    importType: "item_update",
    fileName: "",
    rowCount: totalRows,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
