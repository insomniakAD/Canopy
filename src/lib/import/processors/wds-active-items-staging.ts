// ============================================================================
// WDS Active Items — Staging-aware Processor
// ============================================================================
// Source: WDS Active Items report (actvitemrpt_*.xlsx), uploaded as-is.
// Two sections separated by a "KIT PARENT ITEMS:" divider row in column A:
//   1) Regular items — col A is null (standalone), "c" (kit child), or "A" (assembly)
//   2) Kit parents   — col A = "K" for every row
//
// Columns (0-indexed):
//   A=section/role marker, B=ITEM#, C=COUNTRY OF ORIGIN, D=STATUS,
//   E=DESCRIPTION (used as name), F=BASE PRICE, G=LATEST/REPL COST, H=DI
//
// Status mapping: blank→active, "Min=0"→end_of_life, "New"→new_item,
//                 "Discontinued"→discontinued.
// DI column: only applied when non-null; otherwise existing isDiEligible preserved.
// ============================================================================

import type { PrismaClient, Country, SkuStatus } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseSpreadsheetRaw, toNumber } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
} from "../staging/types";

const COL_TYPE = 0;
const COL_SKU = 1;
const COL_COUNTRY = 2;
const COL_STATUS = 3;
const COL_NAME = 4;
const COL_BASE = 5;
const COL_REPL = 6;
const COL_DI = 7;

const HEADER_ROW = 1;       // file row 2 — "ITEM#", "COUNTRY OF ORIGIN", ...
const FIRST_DATA_ROW = 2;   // file row 3
const KIT_DIVIDER = "KIT PARENT ITEMS:";

const VALID_COUNTRIES: Country[] = ["china", "malaysia", "thailand", "indonesia"];
const YES = /^(y|yes|true|t|1)$/i;
const NO = /^(n|no|false|f|0)$/i;

function mapStatus(raw: string): SkuStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return "active";
  if (s === "min=0") return "end_of_life";
  if (s === "new") return "new_item";
  if (s === "discontinued") return "discontinued";
  return null;
}

// ---------- Payload shape ----------

interface StagedActiveItem {
  skuCode: string;
  isNew: boolean;
  fields: {
    name: string;
    status: SkuStatus;
    originCountry: Country | null;
    basePrice: number | null;
    replacementCost: number | null;
    isAssembly: boolean;
    isKitParent: boolean;
    isKitComponent: boolean;
    /** Only set when col H is non-null. Absent = preserve existing. */
    isDiEligible?: boolean;
  };
}

export interface WdsActiveItemsPayload {
  items: StagedActiveItem[];
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<WdsActiveItemsPayload>> {
  const { buffer } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: WdsActiveItemsPayload = { items: [] };

  const raw = parseSpreadsheetRaw(buffer);
  if (raw.length <= FIRST_DATA_ROW) {
    return { payload, rowCount: 0, willImport: 0, willSkip: 0, errors };
  }

  // Quick header sanity check — fail fast if this isn't an Active Items export.
  const headerRow = raw[HEADER_ROW] ?? [];
  const headerStr = headerRow.map((c) => (c == null ? "" : String(c).trim())).join("|");
  if (!/ITEM#/i.test(headerStr) || !/COUNTRY/i.test(headerStr) || !/STATUS/i.test(headerStr)) {
    errors.push({
      rowNumber: HEADER_ROW + 1,
      fieldName: "header",
      errorType: "format_error",
      message: `Header row missing expected WDS Active Items columns. Found: "${headerStr}"`,
    });
    return { payload, rowCount: raw.length - FIRST_DATA_ROW, willImport: 0, willSkip: 0, errors };
  }

  // Pre-fetch all existing SKUs we might touch — single query.
  const candidateCodes: string[] = [];
  for (let i = FIRST_DATA_ROW; i < raw.length; i++) {
    const v = raw[i]?.[COL_SKU];
    if (v != null && String(v).trim()) candidateCodes.push(String(v).trim());
  }
  const existingSkus = candidateCodes.length
    ? await db.sku.findMany({
        where: { skuCode: { in: candidateCodes } },
        select: { id: true, skuCode: true, isDiEligible: true },
      })
    : [];
  const existingByCode = new Map(existingSkus.map((s) => [s.skuCode, s]));

  // Track skuCodes seen in this file to detect duplicates.
  const seen = new Set<string>();
  let inKitSection = false;
  let willSkip = 0;
  let dataRowCount = 0;

  for (let i = FIRST_DATA_ROW; i < raw.length; i++) {
    const row = raw[i];
    const rowNum = i + 1; // 1-based for user display
    if (!row || row.every((c) => c === null || c === "")) continue;
    dataRowCount++;

    const typeMarker = row[COL_TYPE] != null ? String(row[COL_TYPE]).trim() : "";

    // Section divider — content match, not row-position based.
    if (typeMarker === KIT_DIVIDER) {
      inKitSection = true;
      continue;
    }

    const skuCode = row[COL_SKU] != null ? String(row[COL_SKU]).trim() : "";
    if (!skuCode) {
      willSkip++;
      continue;
    }

    if (seen.has(skuCode)) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "ITEM#",
        errorType: "invalid_value",
        message: `Duplicate SKU "${skuCode}" in this file — keeping the first occurrence.`,
        rawValue: skuCode,
      });
      continue;
    }
    seen.add(skuCode);

    // Marker → flags.
    const markerLower = typeMarker.toLowerCase();
    let isAssembly = false;
    let isKitParent = false;
    let isKitComponent = false;
    if (markerLower === "c") {
      isKitComponent = true;
    } else if (markerLower === "a") {
      isAssembly = true;
    } else if (markerLower === "k") {
      if (!inKitSection) {
        errors.push({
          rowNumber: rowNum,
          fieldName: "marker",
          errorType: "invalid_value",
          message: `"K" marker on SKU "${skuCode}" appeared before the "${KIT_DIVIDER}" divider.`,
          rawValue: typeMarker,
        });
        continue;
      }
      isKitParent = true;
    } else if (markerLower !== "") {
      errors.push({
        rowNumber: rowNum,
        fieldName: "marker",
        errorType: "invalid_value",
        message: `Unknown column-A marker "${typeMarker}" on SKU "${skuCode}". Expected blank, "c", "A", or "K".`,
        rawValue: typeMarker,
      });
      continue;
    }

    // Country — optional. Kit parents and components often have no country in WDS.
    const countryRaw = row[COL_COUNTRY] != null ? String(row[COL_COUNTRY]).trim().toLowerCase() : "";
    let country: Country | null = null;
    if (countryRaw) {
      country = VALID_COUNTRIES.find((c) => c === countryRaw) ?? null;
      if (!country) {
        errors.push({
          rowNumber: rowNum,
          fieldName: "COUNTRY OF ORIGIN",
          errorType: "invalid_value",
          message: `Unknown country "${countryRaw}" on SKU "${skuCode}". Valid: ${VALID_COUNTRIES.join(", ")}.`,
          rawValue: countryRaw,
        });
        continue;
      }
    }

    // Status.
    const statusRaw = row[COL_STATUS] != null ? String(row[COL_STATUS]) : "";
    const status = mapStatus(statusRaw);
    if (status === null) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "STATUS",
        errorType: "invalid_value",
        message: `Unknown status "${statusRaw.trim()}" on SKU "${skuCode}". Expected blank, Min=0, New, or Discontinued.`,
        rawValue: statusRaw,
      });
      continue;
    }

    // Name.
    const name = row[COL_NAME] != null ? String(row[COL_NAME]).trim() : "";
    if (!name) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "DESCRIPTION",
        errorType: "invalid_value",
        message: `SKU "${skuCode}" is missing DESCRIPTION (used as item name).`,
        rawValue: "",
      });
      continue;
    }

    const basePrice = toNumber(row[COL_BASE]);
    const replacementCost = toNumber(row[COL_REPL]);

    const fields: StagedActiveItem["fields"] = {
      name,
      status,
      originCountry: country,
      basePrice,
      replacementCost,
      isAssembly,
      isKitParent,
      isKitComponent,
    };

    // DI: only set if non-null AND parses cleanly.
    const diRaw = row[COL_DI];
    if (diRaw != null && String(diRaw).trim() !== "") {
      const diStr = String(diRaw).trim();
      if (YES.test(diStr)) fields.isDiEligible = true;
      else if (NO.test(diStr)) fields.isDiEligible = false;
      else {
        errors.push({
          rowNumber: rowNum,
          fieldName: "DI",
          errorType: "invalid_value",
          message: `DI value "${diStr}" on SKU "${skuCode}" not recognized as YES/NO; field will be left unchanged.`,
          rawValue: diStr,
        });
        // Don't skip the row — just leave isDiEligible absent.
      }
    }

    payload.items.push({
      skuCode,
      isNew: !existingByCode.has(skuCode),
      fields,
    });
  }

  return {
    payload,
    rowCount: dataRowCount,
    willImport: payload.items.length,
    willSkip,
    errors,
  };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  _batchId: string,
  payload: WdsActiveItemsPayload
): Promise<WriteResult> {
  let imported = 0;

  await db.$transaction(
    async (tx) => {
      for (const item of payload.items) {
        const f = item.fields;
        if (item.isNew) {
          await tx.sku.create({
            data: {
              skuCode: item.skuCode,
              name: f.name,
              status: f.status,
              originCountry: f.originCountry,
              basePrice: f.basePrice,
              replacementCost: f.replacementCost,
              isAssembly: f.isAssembly,
              isKitParent: f.isKitParent,
              isKitComponent: f.isKitComponent,
              ...(f.isDiEligible !== undefined ? { isDiEligible: f.isDiEligible } : {}),
            },
          });
        } else {
          const data: Record<string, unknown> = {
            name: f.name,
            status: f.status,
            originCountry: f.originCountry,
            basePrice: f.basePrice,
            replacementCost: f.replacementCost,
            isAssembly: f.isAssembly,
            isKitParent: f.isKitParent,
            isKitComponent: f.isKitComponent,
          };
          if (f.isDiEligible !== undefined) data.isDiEligible = f.isDiEligible;
          await tx.sku.update({ where: { skuCode: item.skuCode }, data });
        }
        imported++;
      }
    },
    { timeout: 30000 }
  );

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  _db: PrismaClient,
  payload: WdsActiveItemsPayload
): Promise<DiffSummary> {
  const newRows = payload.items.filter((i) => i.isNew).length;
  const updatedRows = payload.items.length - newRows;

  const warnings: GateCheckResult["softFails"] = [];

  const eolItems = payload.items.filter((i) => i.fields.status === "end_of_life");
  if (eolItems.length > 0) {
    warnings.push({
      code: "items_marked_end_of_life",
      message: `${eolItems.length} SKU(s) will be marked end_of_life ("Min=0" in WDS).`,
      count: eolItems.length,
      samples: eolItems.slice(0, 5).map((i) => i.skuCode),
    });
  }

  const newItems = payload.items.filter((i) => i.fields.status === "new_item");
  if (newItems.length > 0) {
    warnings.push({
      code: "items_marked_new",
      message: `${newItems.length} SKU(s) will be flagged as new_item.`,
      count: newItems.length,
      samples: newItems.slice(0, 5).map((i) => i.skuCode),
    });
  }

  const kitParents = payload.items.filter((i) => i.fields.isKitParent).length;
  if (kitParents > 0) {
    warnings.push({
      code: "kit_parents_imported",
      message: `${kitParents} kit parent SKU(s) will be created/updated. Run Kit Composition next to link components.`,
      count: kitParents,
    });
  }

  return {
    totalStagedRows: payload.items.length,
    newRows,
    updatedRows,
    unchangedRows: 0,
    warnings,
  };
}

// ---------- runGates ----------

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const wdsActiveItemsStaging: ProcessorStagingContract<WdsActiveItemsPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
