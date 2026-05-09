// ============================================================================
// WDS pitem.json — Staging-aware Processor
// ============================================================================
// Source: pitem.json (Vercel Blob, populated by Golf's purchasing-sync
// service from WDS). One row per PO line item.
//
// Replaces porder.json / cont-det.json for any per-SKU view. The legacy
// `purchase_orders` (Excel) and the existing blob-purchase-orders adapter
// continue to work for backward compatibility — this processor is registered
// separately under ImportType.wds_pitem.
//
// Field-naming gotcha (verified by Golf's probe across 1300+ closed POs):
//   pi.date-promise = ETD (vendor ship-by commitment)
//   pi.date-needed  = ETA (when buyer expects it at WHSE)
// Counterintuitive but correct. UI labels say "ETD"/"ETA" — never expose
// raw WDS field names to users.
//
// Write strategy: delete-and-insert lines per PO. pitem.json is the
// authoritative source for the PO's line composition; re-imports yield the
// same DB state.
//
// Status policy (per user directive 2026-05-09: "Wait for PO status to be
// set by WDS to keep data consistent"):
//   - For NEW POs: status = "received" if dateOrderClosed != null, else
//     "ordered". This is a direct mapping from a single WDS source field,
//     not a derivation from quantities.
//   - For EXISTING POs: status is NOT modified by this importer. Leave any
//     manual buyer flag alone. Surface a soft warning when dateOrderClosed
//     transitions from null → set, suggesting the buyer review status.
//
// Vendor auto-create (per user directive 2026-05-09: "OK to create since
// data is coming from source of truth"):
//   - Unknown vendorNum → create Factory with vendorCode=vendorNum,
//     name=vendorName, country=country (from line). Surfaced as soft warning.
// ============================================================================

import type { PrismaClient, PoStatus, PoReceivingLocation, Country } from "@/generated/prisma/client";
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

// ---------- Helpers ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s;
}

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}

function asDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!s || !ISO_DATE.test(s)) return null;
  const d = new Date(s.slice(0, 10));
  return isNaN(d.getTime()) ? null : s.slice(0, 10);
}

function recLocFromWds(v: unknown): PoReceivingLocation | null {
  const s = String(v ?? "").trim();
  if (s === "1") return "warehouse";
  if (s === "3") return "direct_import";
  return null;
}

// Map an arbitrary string to the Country enum if possible.
// pitem.json `country` field shape is uncertain — accept ISO codes, full
// names, or known Winsome aliases. Returns null if no match.
// Country enum has only the four countries Winsome currently sources from.
// If pitem.json reports a country outside this set (e.g. Vietnam, India),
// the factory still gets created via vendor auto-create, just without a
// Country value — the country can be filled in via the Vendors sheet later.
const COUNTRY_ALIASES: Record<string, Country> = {
  china: "china",
  cn: "china",
  malaysia: "malaysia",
  my: "malaysia",
  thailand: "thailand",
  th: "thailand",
  indonesia: "indonesia",
  id: "indonesia",
};

function asCountry(v: unknown): Country | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  return COUNTRY_ALIASES[s] ?? null;
}

function extractRecords(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.rows)) return obj.rows;
    if (Array.isArray(obj.records)) return obj.records;
  }
  return null;
}

// ---------- Payload shape ----------

interface StagedPitemLine {
  skuId: string;
  skuCode: string;
  lineNum: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityCancelled: number;
  /** Pre-computed by WDS — do NOT recompute from qtyOrd-qtyReceived-qtyCancel. */
  quantityRemaining: number | null;
  recLoc: PoReceivingLocation;
  datePromise: string | null; // ETD
  dateNeeded: string | null;  // ETA
  dateLineClosed: string | null;
  dwg: string | null;
  fob: string | null;
  /** Pending transition id to auto-consume on commit (mirrors Excel/PO-blob path). */
  pendingTransitionId: string | null;
  transitionData: {
    newDefaultFactoryId: string;
    newUnitCost: number | null;
    newMoq: number | null;
    newFclQty40GP: number | null;
    newFclQty40HQ: number | null;
  } | null;
}

interface StagedPitemPo {
  poNumber: string;
  factoryId: string;
  vendorNum: string;
  vendorName: string | null;
  lotNumber: string | null;
  /** Used only when the PO does not already exist. Existing-PO status is left untouched. */
  statusForNewPo: PoStatus;
  orderDate: string | null;       // pitem.dateIssued → PurchaseOrder.orderDate
  dateClosed: string | null;       // pitem.dateOrderClosed → PurchaseOrder.dateClosed
  firstReceiveDate: string | null;
  lastReceiveDate: string | null;
  /** Backward-compat aliases written alongside the raw WDS fields. */
  estimatedShipDate: string | null;
  estimatedArrivalDate: string | null;
  actualArrivalDate: string | null;
  lineItems: StagedPitemLine[];
}

interface PendingVendorAutoCreate {
  vendorNum: string;
  vendorName: string | null;
  country: Country | null;
}

export interface PitemPayload {
  pos: StagedPitemPo[];
  /** Vendors that will be auto-created on commit. */
  pendingVendorCreates: PendingVendorAutoCreate[];
  /** SKU codes referenced in pitem.json that don't exist in Canopy yet. */
  unknownSkuCodes: string[];
  /** PO numbers where dateOrderClosed transitions from null → set. */
  closureTransitions: string[];
  totalLines: number;
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput,
): Promise<ParseResult<PitemPayload>> {
  const { buffer } = input;
  const errors: ImportErrorDetail[] = [];

  const emptyPayload: PitemPayload = {
    pos: [],
    pendingVendorCreates: [],
    unknownSkuCodes: [],
    closureTransitions: [],
    totalLines: 0,
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch (e) {
    errors.push({
      rowNumber: 0,
      errorType: "format_error",
      message: `Invalid JSON: ${(e as Error).message}`,
    });
    return { payload: emptyPayload, rowCount: 0, willImport: 0, willSkip: 0, errors };
  }

  const records = extractRecords(parsed);
  if (!records) {
    errors.push({
      rowNumber: 0,
      errorType: "format_error",
      message: "Expected a JSON array or an object with `data`/`rows`/`records` property.",
    });
    return { payload: emptyPayload, rowCount: 0, willImport: 0, willSkip: 0, errors };
  }

  // ---- Group rows by orderNum ----
  type RawRow = Record<string, unknown> & { _rowIdx: number };
  const grouped = new Map<string, RawRow[]>();
  const skuCodes = new Set<string>();
  const vendorNums = new Set<string>();
  const unknownSkus = new Set<string>();

  for (let i = 0; i < records.length; i++) {
    const r = records[i] as Record<string, unknown>;
    const rowNum = i + 1;

    const orderNum = asString(r.orderNum);
    if (!orderNum) {
      errors.push({ rowNumber: rowNum, fieldName: "orderNum", errorType: "format_error", message: "Missing orderNum" });
      continue;
    }
    const partNum = asString(r.partNum);
    if (!partNum) {
      errors.push({ rowNumber: rowNum, fieldName: "partNum", errorType: "format_error", message: "Missing partNum" });
      continue;
    }
    const lineNum = asInt(r.lineNum);
    if (lineNum === null || lineNum < 1) {
      errors.push({ rowNumber: rowNum, fieldName: "lineNum", errorType: "format_error", message: "Missing or invalid lineNum (must be ≥ 1)" });
      continue;
    }
    const recLoc = recLocFromWds(r.recLoc);
    if (!recLoc) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "recLoc",
        errorType: "format_error",
        message: 'recLoc must be "1" (warehouse) or "3" (direct_import)',
        rawValue: String(r.recLoc ?? ""),
      });
      continue;
    }
    const vendorNum = asString(r.vendorNum);
    if (!vendorNum) {
      errors.push({ rowNumber: rowNum, fieldName: "vendorNum", errorType: "format_error", message: "Missing vendorNum" });
      continue;
    }

    skuCodes.add(partNum);
    vendorNums.add(vendorNum);

    const list = grouped.get(orderNum) ?? [];
    list.push({ ...r, _rowIdx: rowNum });
    grouped.set(orderNum, list);
  }

  // ---- Pre-fetch SKUs ----
  const skuRecords = skuCodes.size
    ? await db.sku.findMany({
        where: { skuCode: { in: Array.from(skuCodes) } },
        select: { id: true, skuCode: true, defaultFactoryId: true },
      })
    : [];
  const skuByCode = new Map(skuRecords.map((s) => [s.skuCode, s]));
  for (const code of skuCodes) {
    if (!skuByCode.has(code)) unknownSkus.add(code);
  }

  // ---- Pre-fetch existing factories (by vendorCode) ----
  const factories = vendorNums.size
    ? await db.factory.findMany({
        where: { vendorCode: { in: Array.from(vendorNums) } },
        select: { id: true, vendorCode: true, name: true, country: true },
      })
    : [];
  const factoryByVendor = new Map(
    factories
      .filter((f): f is typeof f & { vendorCode: string } => f.vendorCode !== null)
      .map((f) => [f.vendorCode, f]),
  );

  // ---- Pre-fetch existing POs (to detect closure transitions) ----
  const existingPos = grouped.size
    ? await db.purchaseOrder.findMany({
        where: { poNumber: { in: Array.from(grouped.keys()) } },
        select: { poNumber: true, dateClosed: true, status: true },
      })
    : [];
  const existingPoMap = new Map(existingPos.map((p) => [p.poNumber, p]));

  // ---- Pre-fetch pending vendor transitions for affected SKUs ----
  const skuIds = skuRecords.map((s) => s.id);
  const pendingTransitions = skuIds.length
    ? await db.pendingVendorTransition.findMany({
        where: { skuId: { in: skuIds }, status: "pending" },
        select: {
          id: true, skuId: true, toFactoryId: true,
          newUnitCost: true, newMoq: true, newFclQty40GP: true, newFclQty40HQ: true,
        },
      })
    : [];
  const transitionBySkuAndFactory = new Map<string, typeof pendingTransitions[number]>();
  for (const t of pendingTransitions) {
    transitionBySkuAndFactory.set(`${t.skuId}|${t.toFactoryId}`, t);
  }

  // ---- Build payload ----
  const payload: PitemPayload = {
    pos: [],
    pendingVendorCreates: [],
    unknownSkuCodes: Array.from(unknownSkus),
    closureTransitions: [],
    totalLines: 0,
  };
  const vendorCreateSeen = new Set<string>();
  let willImport = 0;

  for (const [orderNum, rows] of grouped) {
    const firstRow = rows[0];

    const vendorNum = asString(firstRow.vendorNum)!;
    const vendorName = asString(firstRow.vendorName);
    const country = asCountry(firstRow.country);

    // Resolve factory: existing or queue for auto-create
    let factoryId: string | null = factoryByVendor.get(vendorNum)?.id ?? null;
    if (!factoryId && !vendorCreateSeen.has(vendorNum)) {
      payload.pendingVendorCreates.push({ vendorNum, vendorName, country });
      vendorCreateSeen.add(vendorNum);
    }
    // factoryId stays null until commit-time creation; writeFromPayload resolves it

    // Lot number: take first non-null lotNum across lines.
    // Per Winsome's PO/Lot model, lotNum should be consistent per PO.
    let lotNumber: string | null = null;
    let inconsistentLot = false;
    for (const row of rows) {
      const ln = asString(row.lotNum);
      if (ln) {
        if (lotNumber === null) lotNumber = ln;
        else if (ln !== lotNumber) inconsistentLot = true;
      }
    }
    if (inconsistentLot) {
      errors.push({
        rowNumber: firstRow._rowIdx,
        fieldName: "lotNum",
        errorType: "invalid_value",
        message: `PO ${orderNum} has inconsistent lotNum across lines (Winsome model expects 1 PO = 1 Lot#). Using first non-null value: "${lotNumber}".`,
      });
    }

    const dateIssued = asDate(firstRow.dateIssued);
    const dateOrderClosed = asDate(firstRow.dateOrderClosed);
    const firstReceiveDate = asDate(firstRow.firstReceiveDate);
    const lastReceiveDate = asDate(firstRow.lastReceiveDate);

    // Closure-transition detection: existing PO + dateClosed previously null + now set
    const existing = existingPoMap.get(orderNum);
    if (existing && existing.dateClosed === null && dateOrderClosed !== null) {
      payload.closureTransitions.push(orderNum);
    }

    // Status policy: only set status for NEW POs (not in DB yet).
    const statusForNewPo: PoStatus = dateOrderClosed !== null ? "received" : "ordered";

    // Build line items
    const lineItems: StagedPitemLine[] = [];
    for (const row of rows) {
      const partNum = asString(row.partNum)!;
      const sku = skuByCode.get(partNum);
      if (!sku) continue; // already counted in unknownSkus

      const lineNum = asInt(row.lineNum)!;
      const recLoc = recLocFromWds(row.recLoc)!;
      const qtyOrd = asInt(row.qtyOrd) ?? 0;
      const qtyReceived = asInt(row.qtyReceived) ?? 0;
      const qtyCancel = asInt(row.qtyCancel) ?? 0;
      const qtyRemaining = asInt(row.qtyRemaining); // pre-computed by WDS — read directly

      // Vendor transition lookup uses (sku, factory). Factory may be auto-created.
      const transitionKey = factoryId ? `${sku.id}|${factoryId}` : null;
      const transition = transitionKey ? transitionBySkuAndFactory.get(transitionKey) : null;

      lineItems.push({
        skuId: sku.id,
        skuCode: partNum,
        lineNum,
        quantityOrdered: qtyOrd,
        quantityReceived: qtyReceived,
        quantityCancelled: qtyCancel,
        quantityRemaining: qtyRemaining,
        recLoc,
        datePromise: asDate(row.datePromise),
        dateNeeded: asDate(row.dateNeeded),
        dateLineClosed: asDate(row.dateLineClosed),
        dwg: asString(row.dwg),
        fob: asString(row.fob),
        pendingTransitionId: transition?.id ?? null,
        transitionData: transition
          ? {
              newDefaultFactoryId: factoryId!,
              newUnitCost: transition.newUnitCost != null ? Number(transition.newUnitCost) : null,
              newMoq: transition.newMoq,
              newFclQty40GP: transition.newFclQty40GP,
              newFclQty40HQ: transition.newFclQty40HQ,
            }
          : null,
      });
    }

    if (lineItems.length === 0) continue; // PO has no resolvable lines

    // Backward-compat aliases (deprecated PO-level dates kept during migration window)
    const allPromise = lineItems.map((l) => l.datePromise).filter((d): d is string => d !== null);
    const allNeeded = lineItems.map((l) => l.dateNeeded).filter((d): d is string => d !== null);
    const estimatedShipDate = allPromise.length ? allPromise.reduce((a, b) => (a < b ? a : b)) : null;
    const estimatedArrivalDate = allNeeded.length ? allNeeded.reduce((a, b) => (a > b ? a : b)) : null;

    payload.pos.push({
      poNumber: orderNum,
      // factoryId may be null until commit-time auto-create. Use placeholder; resolved in writeFromPayload.
      factoryId: factoryId ?? `__AUTO_CREATE__${vendorNum}`,
      vendorNum,
      vendorName,
      lotNumber,
      statusForNewPo,
      orderDate: dateIssued,
      dateClosed: dateOrderClosed,
      firstReceiveDate,
      lastReceiveDate,
      estimatedShipDate,
      estimatedArrivalDate,
      actualArrivalDate: firstReceiveDate, // alias
      lineItems,
    });
    willImport += lineItems.length;
    payload.totalLines += lineItems.length;
  }

  return {
    payload,
    rowCount: records.length,
    willImport,
    willSkip: records.length - willImport - errors.length,
    errors,
  };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  _batchId: string,
  payload: PitemPayload,
): Promise<WriteResult> {
  let imported = 0;

  await db.$transaction(
    async (tx) => {
      // ---- Auto-create unknown vendors ----
      const vendorIdByNum = new Map<string, string>();
      for (const create of payload.pendingVendorCreates) {
        const existing = await tx.factory.findFirst({
          where: { vendorCode: create.vendorNum },
          select: { id: true },
        });
        if (existing) {
          vendorIdByNum.set(create.vendorNum, existing.id);
          continue;
        }
        const created = await tx.factory.create({
          data: {
            vendorCode: create.vendorNum,
            name: create.vendorName ?? `Vendor ${create.vendorNum}`,
            country: create.country,
          },
          select: { id: true },
        });
        vendorIdByNum.set(create.vendorNum, created.id);
      }

      // ---- Per-PO write ----
      for (const po of payload.pos) {
        // Resolve placeholder factoryId if needed
        let factoryId = po.factoryId;
        if (factoryId.startsWith("__AUTO_CREATE__")) {
          const vendorNum = factoryId.slice("__AUTO_CREATE__".length);
          const resolved = vendorIdByNum.get(vendorNum);
          if (!resolved) {
            throw new Error(`Internal error: factory for vendorNum "${vendorNum}" missing after auto-create phase.`);
          }
          factoryId = resolved;
        }

        // ---- Upsert PO ----
        const existing = await tx.purchaseOrder.findUnique({ where: { poNumber: po.poNumber } });

        const sharedFields = {
          factoryId,
          orderDate: po.orderDate ? new Date(po.orderDate) : null,
          dateClosed: po.dateClosed ? new Date(po.dateClosed) : null,
          firstReceiveDate: po.firstReceiveDate ? new Date(po.firstReceiveDate) : null,
          lastReceiveDate: po.lastReceiveDate ? new Date(po.lastReceiveDate) : null,
          estimatedShipDate: po.estimatedShipDate ? new Date(po.estimatedShipDate) : null,
          estimatedArrivalDate: po.estimatedArrivalDate ? new Date(po.estimatedArrivalDate) : null,
          actualArrivalDate: po.actualArrivalDate ? new Date(po.actualArrivalDate) : null,
          vendorNum: po.vendorNum,
          vendorName: po.vendorName,
          // lotNumber intentionally excluded — lot_number has a @unique constraint and
          // is owned by the porder-recent.json / Excel PO-header import path.
          // pitem.json is authoritative for line composition, not PO header identity.
        };

        const upsertedPo = existing
          ? await tx.purchaseOrder.update({
              where: { poNumber: po.poNumber },
              // Status NOT included — preserve existing
              data: sharedFields,
            })
          : await tx.purchaseOrder.create({
              data: { poNumber: po.poNumber, status: po.statusForNewPo, ...sharedFields },
            });

        // ---- Delete-and-insert lines (pitem is authoritative for PO line composition) ----
        await tx.poLineItem.deleteMany({ where: { poId: upsertedPo.id } });
        for (const line of po.lineItems) {
          await tx.poLineItem.create({
            data: {
              poId: upsertedPo.id,
              skuId: line.skuId,
              lineNum: line.lineNum,
              quantityOrdered: line.quantityOrdered,
              quantityReceived: line.quantityReceived,
              quantityCancelled: line.quantityCancelled,
              quantityRemaining: line.quantityRemaining,
              recLoc: line.recLoc,
              datePromise: line.datePromise ? new Date(line.datePromise) : null,
              dateNeeded: line.dateNeeded ? new Date(line.dateNeeded) : null,
              dateLineClosed: line.dateLineClosed ? new Date(line.dateLineClosed) : null,
              dwg: line.dwg,
              fob: line.fob,
            },
          });

          // Vendor-transition auto-consumption (mirrors Excel/PO-blob path)
          if (line.pendingTransitionId && line.transitionData) {
            const td = line.transitionData;
            const skuUpdate: Record<string, unknown> = { defaultFactoryId: td.newDefaultFactoryId };
            if (td.newUnitCost != null) skuUpdate.factoryCost = td.newUnitCost;
            if (td.newMoq != null) skuUpdate.moq = td.newMoq;
            if (td.newFclQty40GP != null) skuUpdate.fclQty40GP = td.newFclQty40GP;
            if (td.newFclQty40HQ != null) skuUpdate.fclQty40HQ = td.newFclQty40HQ;
            await tx.sku.update({ where: { id: line.skuId }, data: skuUpdate });
            await tx.pendingVendorTransition.update({
              where: { id: line.pendingTransitionId },
              data: { status: "consumed" },
            });
          }

          imported++;
        }
      }
    },
    { timeout: 120_000 },
  );

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: PitemPayload,
): Promise<DiffSummary> {
  const warnings: GateCheckResult["softFails"] = [];

  if (payload.pendingVendorCreates.length > 0) {
    warnings.push({
      code: "vendors_auto_created",
      message: `${payload.pendingVendorCreates.length} unknown vendor(s) will be auto-created on commit.`,
      count: payload.pendingVendorCreates.length,
      samples: payload.pendingVendorCreates
        .slice(0, 10)
        .map((v) => `${v.vendorNum}${v.vendorName ? ` (${v.vendorName})` : ""}`),
    });
  }
  if (payload.unknownSkuCodes.length > 0) {
    warnings.push({
      code: "unknown_skus_skipped",
      message: `${payload.unknownSkuCodes.length} SKU(s) referenced in pitem.json are not in Canopy and will be skipped. Backfill via winpart.json / item update first.`,
      count: payload.unknownSkuCodes.length,
      samples: payload.unknownSkuCodes.slice(0, 10),
    });
  }
  if (payload.closureTransitions.length > 0) {
    warnings.push({
      code: "po_closure_transitions",
      message: `${payload.closureTransitions.length} PO(s) have dateOrderClosed transitioning from null → set. Status is NOT auto-flipped on existing POs — review and update if needed.`,
      count: payload.closureTransitions.length,
      samples: payload.closureTransitions.slice(0, 10),
    });
  }
  const transitionCount = payload.pos
    .flatMap((p) => p.lineItems)
    .filter((l) => l.pendingTransitionId !== null).length;
  if (transitionCount > 0) {
    warnings.push({
      code: "vendor_transitions_consumed",
      message: `${transitionCount} pending vendor transition(s) will be auto-consumed when this import commits.`,
      count: transitionCount,
    });
  }

  if (payload.pos.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings };
  }

  const poNumbers = payload.pos.map((p) => p.poNumber);
  const existingPos = await db.purchaseOrder.findMany({
    where: { poNumber: { in: poNumbers } },
    include: { lineItems: { select: { skuId: true, lineNum: true, quantityOrdered: true } } },
  });
  const existingMap = new Map(existingPos.map((p) => [p.poNumber, p]));

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  const rowDeltas: RowDelta[] = [];

  for (const po of payload.pos) {
    const existing = existingMap.get(po.poNumber);
    if (!existing) {
      newRows++;
      for (const line of po.lineItems) {
        rowDeltas.push({ skuCode: line.skuCode, previous: null, next: line.quantityOrdered, delta: line.quantityOrdered });
      }
      continue;
    }

    // Compare line composition: keyed by lineNum
    const existingByLine = new Map(existing.lineItems.map((l) => [l.lineNum, l]));
    let changed = false;
    for (const line of po.lineItems) {
      const prior = existingByLine.get(line.lineNum);
      if (!prior) {
        newRows++;
        changed = true;
        rowDeltas.push({ skuCode: line.skuCode, previous: null, next: line.quantityOrdered, delta: line.quantityOrdered });
      } else if (prior.quantityOrdered !== line.quantityOrdered) {
        updatedRows++;
        changed = true;
        rowDeltas.push({
          skuCode: line.skuCode,
          previous: prior.quantityOrdered,
          next: line.quantityOrdered,
          delta: line.quantityOrdered - prior.quantityOrdered,
        });
      } else {
        unchangedRows++;
      }
    }
    if (!changed && existing.lineItems.length === po.lineItems.length) unchangedRows++;
    else if (changed) updatedRows++;
  }

  const topDeltas = [...rowDeltas]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 20);

  return {
    totalStagedRows: payload.totalLines,
    newRows,
    updatedRows,
    unchangedRows,
    topDeltas,
    warnings,
  };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const pitemStaging: ProcessorStagingContract<PitemPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
