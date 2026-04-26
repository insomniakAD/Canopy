// ============================================================================
// Purchase Orders — Staging-aware Processor
// ============================================================================
// Writes PurchaseOrder + PoLineItem rows (upsert by PO number / PO+SKU).
// Also auto-consumes PendingVendorTransition when a matching PO arrives.
//
// Payload: normalized PO groups with their line items + transition candidates.
// Diff: POs by status, line items new/updated, transition auto-consumptions.
// ============================================================================

import type { PrismaClient, PoStatus } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseFlexibleDate, toInt, toNumber } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
  RowDelta,
} from "../staging/types";

const VALID_STATUSES: Record<string, PoStatus> = {
  draft: "draft",
  ordered: "ordered",
  in_production: "in_production",
  "in production": "in_production",
  on_water: "on_water",
  "on water": "on_water",
  at_port: "at_port",
  "at port": "at_port",
  received: "received",
  cancelled: "cancelled",
  canceled: "cancelled",
};

// ---------- Payload shape ----------

interface StagedPoLineItem {
  skuId: string;
  skuCode: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostUsd: number | null;
  /** Pending transition id to auto-consume on commit */
  pendingTransitionId: string | null;
  transitionData: {
    newDefaultFactoryId: string;
    newUnitCost: number | null;
    newMoq: number | null;
    newFclQty40GP: number | null;
    newFclQty40HQ: number | null;
  } | null;
}

interface StagedPo {
  poNumber: string;
  factoryId: string;
  status: PoStatus;
  orderDate: string | null;
  estimatedArrivalDate: string | null;
  lineItems: StagedPoLineItem[];
}

export interface PurchaseOrdersPayload {
  pos: StagedPo[];
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<PurchaseOrdersPayload>> {
  const { rows } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: PurchaseOrdersPayload = { pos: [] };
  let totalLineItems = 0;

  // Group rows by PO number
  const poGroups = new Map<string, { rows: typeof rows; indices: number[] }>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const poNum = row["PO Number"] != null ? String(row["PO Number"]).trim() : "";
    if (!poNum) {
      errors.push({ rowNumber: i + 2, fieldName: "PO Number", errorType: "invalid_value", message: "PO Number is blank" });
      continue;
    }
    const group = poGroups.get(poNum) ?? { rows: [], indices: [] };
    group.rows.push(row);
    group.indices.push(i);
    poGroups.set(poNum, group);
  }

  // Pre-fetch factories
  const factoryNames = new Set<string>();
  for (const [, group] of poGroups) {
    const fr = group.rows[0];
    const name = (fr["Vendor/Factory"] ?? fr["Factory"])?.toString().trim();
    if (name) factoryNames.add(name);
  }
  const factories = factoryNames.size
    ? await db.factory.findMany({
        where: { name: { in: Array.from(factoryNames) } },
        select: { id: true, name: true, vendorCode: true },
      })
    : [];
  const factoryByName = new Map(factories.map((f) => [f.name, f]));
  const factoryByNameInsensitive = new Map(factories.map((f) => [f.name.toLowerCase(), f]));

  // Pre-fetch SKUs
  const itemCodes = new Set<string>();
  for (const [, group] of poGroups) {
    for (const row of group.rows) {
      const code = row["ITEM#"]?.toString().trim();
      if (code) itemCodes.add(code);
    }
  }
  const skuRecords = itemCodes.size
    ? await db.sku.findMany({
        where: { skuCode: { in: Array.from(itemCodes) } },
        select: { id: true, skuCode: true, defaultFactoryId: true },
      })
    : [];
  const skuByCode = new Map(skuRecords.map((s) => [s.skuCode, s]));

  // Pre-fetch pending transitions for affected SKUs
  const skuIds = skuRecords.map((s) => s.id);
  const pendingTransitions = skuIds.length
    ? await db.pendingVendorTransition.findMany({
        where: { skuId: { in: skuIds }, status: "pending" },
        select: { id: true, skuId: true, toFactoryId: true, newUnitCost: true, newMoq: true, newFclQty40GP: true, newFclQty40HQ: true },
      })
    : [];
  type PendingTransition = typeof pendingTransitions[number];
  const transitionBySkuAndFactory = new Map<string, PendingTransition>();
  for (const t of pendingTransitions) {
    transitionBySkuAndFactory.set(`${t.skuId}|${t.toFactoryId}`, t);
  }

  for (const [poNum, group] of poGroups) {
    const firstRow = group.rows[0];
    const rowNum = group.indices[0] + 2;

    const statusRaw = firstRow["Status"] ? String(firstRow["Status"]).trim().toLowerCase() : "";
    const status = VALID_STATUSES[statusRaw];
    if (!status) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "Status",
        errorType: "invalid_value",
        message: `Status "${firstRow["Status"]}" is not valid. Expected: ordered, in production, on water, at port, received, cancelled.`,
        rawValue: String(firstRow["Status"] ?? ""),
      });
      continue;
    }

    let orderDate: Date | null = null;
    let estimatedArrival: Date | null = null;
    try {
      if (firstRow["Order Date"]) orderDate = parseFlexibleDate(String(firstRow["Order Date"]));
    } catch {
      errors.push({ rowNumber: rowNum, fieldName: "Order Date", errorType: "invalid_value", message: `Cannot parse date "${firstRow["Order Date"]}"`, rawValue: String(firstRow["Order Date"]) });
      continue;
    }
    try {
      if (firstRow["Estimated Arrival"]) estimatedArrival = parseFlexibleDate(String(firstRow["Estimated Arrival"]));
    } catch {
      errors.push({ rowNumber: rowNum, fieldName: "Estimated Arrival", errorType: "invalid_value", message: `Cannot parse date "${firstRow["Estimated Arrival"]}"`, rawValue: String(firstRow["Estimated Arrival"]) });
      continue;
    }

    const factoryName = (firstRow["Vendor/Factory"] ?? firstRow["Factory"])?.toString().trim() ?? "";
    const factory =
      factoryByName.get(factoryName) ?? factoryByNameInsensitive.get(factoryName.toLowerCase()) ?? null;

    if (!factory) {
      errors.push({ rowNumber: rowNum, fieldName: "Vendor/Factory", errorType: "invalid_value", message: `Factory "${factoryName}" not found. Add the factory to the system first.`, rawValue: factoryName });
      continue;
    }

    const lineItems: StagedPoLineItem[] = [];
    let lineBlocked = false;

    for (let li = 0; li < group.rows.length; li++) {
      const lineRow = group.rows[li];
      const lineRowNum = group.indices[li] + 2;

      const itemCode = lineRow["ITEM#"]?.toString().trim() ?? "";
      if (!itemCode) {
        errors.push({ rowNumber: lineRowNum, fieldName: "ITEM#", errorType: "invalid_value", message: "ITEM# is blank on PO line" });
        lineBlocked = true;
        continue;
      }

      const sku = skuByCode.get(itemCode);
      if (!sku) {
        errors.push({ rowNumber: lineRowNum, fieldName: "ITEM#", errorType: "missing_sku", message: `SKU "${itemCode}" not found in the system`, rawValue: itemCode });
        lineBlocked = true;
        continue;
      }

      const qtyOrdered = toInt(lineRow["Quantity Ordered"]);
      if (!qtyOrdered || qtyOrdered <= 0) {
        errors.push({ rowNumber: lineRowNum, fieldName: "Quantity Ordered", errorType: "invalid_value", message: `Quantity Ordered "${lineRow["Quantity Ordered"]}" is not valid`, rawValue: String(lineRow["Quantity Ordered"] ?? "") });
        lineBlocked = true;
        continue;
      }

      const qtyReceived = toInt(lineRow["Quantity Received"]) ?? 0;
      const unitCost = toNumber(lineRow["Unit Cost"]);

      // Check if this PO's factory matches a pending vendor transition
      const transitionKey = `${sku.id}|${factory.id}`;
      const transition = transitionBySkuAndFactory.get(transitionKey) ?? null;

      lineItems.push({
        skuId: sku.id,
        skuCode: itemCode,
        quantityOrdered: qtyOrdered,
        quantityReceived: qtyReceived,
        unitCostUsd: unitCost,
        pendingTransitionId: transition?.id ?? null,
        transitionData: transition
          ? {
              newDefaultFactoryId: factory.id,
              newUnitCost: transition.newUnitCost != null ? Number(transition.newUnitCost) : null,
              newMoq: transition.newMoq,
              newFclQty40GP: transition.newFclQty40GP,
              newFclQty40HQ: transition.newFclQty40HQ,
            }
          : null,
      });
      totalLineItems++;
    }

    if (lineBlocked && lineItems.length === 0) continue;

    payload.pos.push({
      poNumber: poNum,
      factoryId: factory.id,
      status,
      orderDate: orderDate?.toISOString() ?? null,
      estimatedArrivalDate: estimatedArrival?.toISOString() ?? null,
      lineItems,
    });
  }

  return { payload, rowCount: rows.length, willImport: totalLineItems, willSkip: 0, errors };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  _batchId: string,
  payload: PurchaseOrdersPayload
): Promise<WriteResult> {
  let imported = 0;

  await db.$transaction(async (tx) => {
    for (const po of payload.pos) {
      const upsertedPo = await tx.purchaseOrder.upsert({
        where: { poNumber: po.poNumber },
        update: {
          status: po.status,
          orderDate: po.orderDate ? new Date(po.orderDate) : null,
          estimatedArrivalDate: po.estimatedArrivalDate ? new Date(po.estimatedArrivalDate) : null,
        },
        create: {
          poNumber: po.poNumber,
          factoryId: po.factoryId,
          status: po.status,
          orderDate: po.orderDate ? new Date(po.orderDate) : null,
          estimatedArrivalDate: po.estimatedArrivalDate ? new Date(po.estimatedArrivalDate) : null,
        },
      });

      for (const line of po.lineItems) {
        const existingLine = await tx.poLineItem.findFirst({
          where: { poId: upsertedPo.id, skuId: line.skuId },
        });

        if (existingLine) {
          await tx.poLineItem.update({
            where: { id: existingLine.id },
            data: { quantityOrdered: line.quantityOrdered, quantityReceived: line.quantityReceived, unitCostUsd: line.unitCostUsd },
          });
        } else {
          await tx.poLineItem.create({
            data: { poId: upsertedPo.id, skuId: line.skuId, quantityOrdered: line.quantityOrdered, quantityReceived: line.quantityReceived, unitCostUsd: line.unitCostUsd },
          });
        }

        // Auto-consume vendor transition
        if (line.pendingTransitionId && line.transitionData) {
          const td = line.transitionData;
          const skuUpdate: Record<string, unknown> = { defaultFactoryId: td.newDefaultFactoryId };
          if (td.newUnitCost != null) skuUpdate.unitCostUsd = td.newUnitCost;
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
  }, { timeout: 30000 });

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: PurchaseOrdersPayload
): Promise<DiffSummary> {
  if (payload.pos.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings: [] };
  }

  const poNumbers = payload.pos.map((p) => p.poNumber);
  const existingPos = await db.purchaseOrder.findMany({
    where: { poNumber: { in: poNumbers } },
    include: { lineItems: { select: { skuId: true, quantityOrdered: true } } },
  });
  const existingPoMap = new Map(existingPos.map((p) => [p.poNumber, p]));

  let newRows = 0;   // new POs
  let updatedRows = 0;
  let unchangedRows = 0;
  const rowDeltas: RowDelta[] = [];

  // Count total line items for totalStagedRows
  const totalLineItems = payload.pos.reduce((s, p) => s + p.lineItems.length, 0);

  for (const po of payload.pos) {
    const existing = existingPoMap.get(po.poNumber);
    if (!existing) {
      newRows++;
      for (const line of po.lineItems) {
        rowDeltas.push({ skuCode: line.skuCode, previous: null, next: line.quantityOrdered, delta: line.quantityOrdered });
      }
    } else {
      const existingLineMap = new Map(existing.lineItems.map((l) => [l.skuId, l.quantityOrdered]));
      let anyChange = po.status !== existing.status;
      for (const line of po.lineItems) {
        const priorQty = existingLineMap.get(line.skuId);
        if (priorQty === undefined) {
          newRows++;
          anyChange = true;
          rowDeltas.push({ skuCode: line.skuCode, previous: null, next: line.quantityOrdered, delta: line.quantityOrdered });
        } else if (priorQty !== line.quantityOrdered) {
          updatedRows++;
          anyChange = true;
          rowDeltas.push({ skuCode: line.skuCode, previous: priorQty, next: line.quantityOrdered, delta: line.quantityOrdered - priorQty });
        } else {
          unchangedRows++;
        }
      }
      if (anyChange) updatedRows++;
      else unchangedRows++;
    }
  }

  const topDeltas = [...rowDeltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);

  const warnings: GateCheckResult["softFails"] = [];
  const transitionCount = payload.pos
    .flatMap((p) => p.lineItems)
    .filter((l) => l.pendingTransitionId !== null).length;
  if (transitionCount > 0) {
    warnings.push({
      code: "vendor_transitions_consumed",
      message: `${transitionCount} vendor transition(s) will be auto-consumed when this import commits.`,
      count: transitionCount,
    });
  }

  return { totalStagedRows: totalLineItems, newRows, updatedRows, unchangedRows, topDeltas, warnings };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const purchaseOrdersStaging: ProcessorStagingContract<PurchaseOrdersPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
