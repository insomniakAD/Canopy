// ============================================================================
// Blob Purchase Orders — Adapter for Golf's porder-recent + cont-det blobs
// ============================================================================
// Combines two files:
//   porder-recent.json — PO header (vendor, dates, total cost, qty)
//   cont-det.json      — PO line items (partNum + qty per container)
//
// Joins them on orderNum and produces a PurchaseOrdersPayload that the
// existing PO write/diff logic in purchase-orders-staging.ts consumes
// unchanged. Vendor-transition auto-consumption is preserved.
//
// Status derivation:
//   dateClosed != null  → "received" (kept for audit trail / historical reports)
//   dateClosed == null  → "ordered"  (open — engine treats as inbound)
//
// quantityReceived:
//   For "received" POs:  set to the line's qtyShip (treat as fully received).
//   For "ordered" POs:   set to 0 (engine assumes nothing has arrived).
//
// unit_cost_usd is NEVER populated by this path — Golf's blob has only PO-level
// totals, not per-line costs. The factory cost from WDS Active Items / Item
// Update remains authoritative.
// ============================================================================

import type { PrismaClient, PoStatus } from "@/generated/prisma/client";
import type { BlobTable } from "@/lib/blob/source";
import type { ImportErrorDetail } from "../types";
import type { ParseResult } from "../staging/types";
import type { PurchaseOrdersPayload } from "./purchase-orders-staging";

const PORDER_REQUIRED = [
  "orderNum", "vendorNum", "dateIssued", "dateNeeded", "dateClosed",
  "costOrig", "ordqtyOrig",
] as const;

const CONTDET_REQUIRED = [
  "ctnrNum", "partNum", "orderNum", "lineNum", "qtyShip",
] as const;

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

/** Parse "2026-04-24" → Date (or null). Tolerates a trailing time component. */
function parseDateField(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse Golf's porder-recent + cont-det blobs into a PurchaseOrdersPayload.
 * Caller is expected to fetch both blobs first (they may be cached separately).
 */
export async function parseBlobPurchaseOrders(
  db: PrismaClient,
  blobs: { porder: BlobTable; contdet: BlobTable },
): Promise<ParseResult<PurchaseOrdersPayload>> {
  const errors: ImportErrorDetail[] = [];
  const payload: PurchaseOrdersPayload = { pos: [] };
  let totalLineItems = 0;

  // ---- Field schema validation ----
  const porderMissing = PORDER_REQUIRED.filter((f) => blobs.porder.fields.indexOf(f) < 0);
  if (porderMissing.length > 0) {
    errors.push({
      rowNumber: 1,
      fieldName: "fields",
      errorType: "format_error",
      message:
        `porder-recent.json missing required field(s): ${porderMissing.join(", ")}. ` +
        `Got: [${blobs.porder.fields.join(", ")}]`,
    });
    return { payload, rowCount: blobs.porder.rows.length, willImport: 0, willSkip: 0, errors };
  }

  const contdetMissing = CONTDET_REQUIRED.filter((f) => blobs.contdet.fields.indexOf(f) < 0);
  if (contdetMissing.length > 0) {
    errors.push({
      rowNumber: 1,
      fieldName: "fields",
      errorType: "format_error",
      message:
        `cont-det.json missing required field(s): ${contdetMissing.join(", ")}. ` +
        `Got: [${blobs.contdet.fields.join(", ")}]`,
    });
    return { payload, rowCount: blobs.porder.rows.length, willImport: 0, willSkip: 0, errors };
  }

  const pIdx = {
    orderNum: blobs.porder.fields.indexOf("orderNum"),
    vendorNum: blobs.porder.fields.indexOf("vendorNum"),
    dateIssued: blobs.porder.fields.indexOf("dateIssued"),
    dateNeeded: blobs.porder.fields.indexOf("dateNeeded"),
    dateClosed: blobs.porder.fields.indexOf("dateClosed"),
  };
  const cIdx = {
    orderNum: blobs.contdet.fields.indexOf("orderNum"),
    partNum: blobs.contdet.fields.indexOf("partNum"),
    qtyShip: blobs.contdet.fields.indexOf("qtyShip"),
  };

  // ---- Aggregate cont-det line items by (orderNum, partNum) ----
  // A SKU may be split across multiple containers — sum qtyShip.
  type LineKey = string; // `${orderNum}|${partNum}`
  const lineQtyByKey = new Map<LineKey, number>();
  const partsByOrder = new Map<string, Set<string>>();
  for (const row of blobs.contdet.rows) {
    const orderNum = row[cIdx.orderNum] != null ? String(row[cIdx.orderNum]).trim() : "";
    const partNum = row[cIdx.partNum] != null ? String(row[cIdx.partNum]).trim() : "";
    const qty = asInt(row[cIdx.qtyShip]) ?? 0;
    if (!orderNum || !partNum) continue;
    const key = `${orderNum}|${partNum}`;
    lineQtyByKey.set(key, (lineQtyByKey.get(key) ?? 0) + qty);
    if (!partsByOrder.has(orderNum)) partsByOrder.set(orderNum, new Set());
    partsByOrder.get(orderNum)!.add(partNum);
  }

  // ---- Pre-fetch factories by vendorCode (porder.vendorNum → Factory) ----
  const vendorCodes = new Set<string>();
  for (const row of blobs.porder.rows) {
    const v = row[pIdx.vendorNum] != null ? String(row[pIdx.vendorNum]).trim() : "";
    if (v) vendorCodes.add(v);
  }
  const factories = vendorCodes.size
    ? await db.factory.findMany({
        where: { vendorCode: { in: Array.from(vendorCodes) } },
        select: { id: true, vendorCode: true },
      })
    : [];
  const factoryByVendorCode = new Map(
    factories.filter((f): f is typeof f & { vendorCode: string } => f.vendorCode !== null)
      .map((f) => [f.vendorCode, f.id]),
  );

  // ---- Pre-fetch SKUs (every partNum referenced anywhere) ----
  const allParts = new Set<string>();
  for (const set of partsByOrder.values()) for (const p of set) allParts.add(p);
  const skuRecords = allParts.size
    ? await db.sku.findMany({
        where: { skuCode: { in: Array.from(allParts) } },
        select: { id: true, skuCode: true, defaultFactoryId: true },
      })
    : [];
  const skuByCode = new Map(skuRecords.map((s) => [s.skuCode, s]));

  // ---- Pre-fetch pending vendor transitions (mirrors Excel processor) ----
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

  // ---- Track header-only POs (open + no cont-det entries) for a soft warning ----
  const headerOnlyOpenPos: string[] = [];

  // ---- Per-PO row processing ----
  for (let i = 0; i < blobs.porder.rows.length; i++) {
    const row = blobs.porder.rows[i];
    const rowNum = i + 1;

    const orderNum = row[pIdx.orderNum] != null ? String(row[pIdx.orderNum]).trim() : "";
    if (!orderNum) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "orderNum",
        errorType: "invalid_value",
        message: "orderNum is blank",
      });
      continue;
    }

    const vendorNum = row[pIdx.vendorNum] != null ? String(row[pIdx.vendorNum]).trim() : "";
    if (!vendorNum) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "vendorNum",
        errorType: "invalid_value",
        message: `PO ${orderNum}: vendorNum is blank`,
        rawValue: orderNum,
      });
      continue;
    }

    const factoryId = factoryByVendorCode.get(vendorNum);
    if (!factoryId) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "vendorNum",
        errorType: "invalid_value",
        message:
          `PO ${orderNum}: factory with vendorCode "${vendorNum}" not found. ` +
          `Add the factory (via WDS Active Items Vendors sheet or manually) before pulling.`,
        rawValue: vendorNum,
      });
      continue;
    }

    const dateClosed = parseDateField(row[pIdx.dateClosed]);
    const status: PoStatus = dateClosed ? "received" : "ordered";
    const orderDate = parseDateField(row[pIdx.dateIssued]);
    const estimatedArrival = parseDateField(row[pIdx.dateNeeded]);

    // ---- Build line items from cont-det aggregation ----
    const parts = partsByOrder.get(orderNum);
    const lineItems: PurchaseOrdersPayload["pos"][number]["lineItems"] = [];
    let lineBlocked = false;

    if (parts) {
      for (const partNum of parts) {
        const sku = skuByCode.get(partNum);
        if (!sku) {
          errors.push({
            rowNumber: rowNum,
            fieldName: "partNum",
            errorType: "missing_sku",
            message:
              `PO ${orderNum}: SKU "${partNum}" not found. Import WDS Active Items first.`,
            rawValue: partNum,
          });
          lineBlocked = true;
          continue;
        }

        const qtyOrdered = lineQtyByKey.get(`${orderNum}|${partNum}`) ?? 0;
        if (qtyOrdered <= 0) continue; // skip empty container slots

        const qtyReceived = status === "received" ? qtyOrdered : 0;

        // Vendor transition auto-consume key
        const transitionKey = `${sku.id}|${factoryId}`;
        const transition = transitionBySkuAndFactory.get(transitionKey) ?? null;

        lineItems.push({
          skuId: sku.id,
          skuCode: partNum,
          quantityOrdered: qtyOrdered,
          quantityReceived: qtyReceived,
          unitCostUsd: null,  // Per design — manual import owns factory cost
          pendingTransitionId: transition?.id ?? null,
          transitionData: transition
            ? {
                newDefaultFactoryId: factoryId,
                newUnitCost: transition.newUnitCost != null ? Number(transition.newUnitCost) : null,
                newMoq: transition.newMoq,
                newFclQty40GP: transition.newFclQty40GP,
                newFclQty40HQ: transition.newFclQty40HQ,
              }
            : null,
        });
        totalLineItems++;
      }
    } else if (!dateClosed) {
      // Open PO with no container detail yet — record header for the warning
      headerOnlyOpenPos.push(orderNum);
    }

    if (lineBlocked && lineItems.length === 0) continue;

    payload.pos.push({
      poNumber: orderNum,
      factoryId,
      status,
      orderDate: orderDate?.toISOString() ?? null,
      estimatedArrivalDate: estimatedArrival?.toISOString() ?? null,
      lineItems,
    });
  }

  // ---- Header-only soft warning surfaced via parse errors so the diff shows it ----
  // We don't error on these — they're a normal state — but we want the user to
  // see the count in the import log.
  if (headerOnlyOpenPos.length > 0) {
    errors.push({
      rowNumber: 0,
      errorType: "format_error",
      message:
        `${headerOnlyOpenPos.length} open PO(s) have no container detail yet ` +
        `(factory hasn't shipped). Header recorded with no line items: ` +
        `${headerOnlyOpenPos.slice(0, 5).join(", ")}` +
        `${headerOnlyOpenPos.length > 5 ? `, +${headerOnlyOpenPos.length - 5} more` : ""}.`,
    });
  }

  return {
    payload,
    rowCount: blobs.porder.rows.length,
    willImport: totalLineItems,
    willSkip: 0,
    errors,
  };
}
