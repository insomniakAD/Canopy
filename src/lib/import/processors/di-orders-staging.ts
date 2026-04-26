// ============================================================================
// DI Orders — Staging-aware Processor
// ============================================================================
// One DiOrder row per (SKU, PO number). Diff: new orders vs updated orders,
// qty delta per order. Soft warning: orphan ASINs with no matching SKU
// (surfaced via parse errors already, no extra gate needed).
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";
import { parseFlexibleDate, isPositiveInt, toInt } from "../utils";
import type {
  ProcessorInput,
  ProcessorStagingContract,
  ParseResult,
  WriteResult,
  DiffSummary,
  GateCheckResult,
  RowDelta,
} from "../staging/types";

const VALID_STATUSES = [
  "draft",
  "ordered",
  "in_production",
  "on_water",
  "at_port",
  "received",
  "cancelled",
] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

// ---------- Payload shape ----------

interface StagedDiOrderRow {
  skuId: string;
  skuCode: string;
  amazonPoNumber: string | null;
  quantity: number;
  orderDate: string;
  estimatedArrivalDate: string | null;
  status: ValidStatus;
  factoryId: string | null;
  isDiEligibleUpdate: boolean;
}

export interface DiOrdersPayload {
  rows: StagedDiOrderRow[];
}

// ---------- Helpers ----------

function safeParseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  try {
    return parseFlexibleDate(value.toString());
  } catch {
    return null;
  }
}

// ---------- parseToPayload ----------

async function parseToPayload(
  db: PrismaClient,
  input: ProcessorInput
): Promise<ParseResult<DiOrdersPayload>> {
  const { rows } = input;
  const errors: ImportErrorDetail[] = [];
  const payload: DiOrdersPayload = { rows: [] };
  let willSkip = 0;

  // Pre-fetch SKUs: collect all identifiers upfront
  const asinSet = new Set<string>();
  const codeSet = new Set<string>();
  for (const row of rows) {
    const asin = row["ASIN"]?.toString().trim();
    const code = (row["ITEM#"] ?? row["ITEM"] ?? row["SKU"])?.toString().trim();
    if (asin) asinSet.add(asin);
    if (code) codeSet.add(code);
  }

  const [byAsin, byCode] = await Promise.all([
    asinSet.size
      ? db.sku.findMany({
          where: { asin: { in: Array.from(asinSet) } },
          select: { id: true, skuCode: true, asin: true, isDiEligible: true },
        })
      : [],
    codeSet.size
      ? db.sku.findMany({
          where: { skuCode: { in: Array.from(codeSet) } },
          select: { id: true, skuCode: true, asin: true, isDiEligible: true },
        })
      : [],
  ]);

  const skuByAsin = new Map(byAsin.map((s) => [s.asin!, s]));
  const skuByCode = new Map(byCode.map((s) => [s.skuCode, s]));

  // Pre-fetch factories
  const factoryNames = new Set<string>();
  for (const row of rows) {
    const name = (row["Factory"] ?? row["Factory Name"] ?? row["FACTORY"])?.toString().trim();
    if (name) factoryNames.add(name);
  }
  const factories = factoryNames.size
    ? await db.factory.findMany({
        where: { name: { in: Array.from(factoryNames), mode: "insensitive" } as { in: string[]; mode: "insensitive" } },
        select: { id: true, name: true },
      })
    : [];
  const factoryByName = new Map(factories.map((f) => [f.name.toLowerCase(), f.id]));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const asin = row["ASIN"]?.toString().trim();
    const itemCode = (row["ITEM#"] ?? row["ITEM"] ?? row["SKU"])?.toString().trim();

    if (!asin && !itemCode) {
      errors.push({ rowNumber: rowNum, errorType: "format_error", message: "Row must have either ASIN or ITEM# to identify the SKU." });
      continue;
    }

    const sku = (asin ? skuByAsin.get(asin) : undefined) ?? (itemCode ? skuByCode.get(itemCode) : undefined);
    if (!sku) {
      errors.push({
        rowNumber: rowNum,
        errorType: "missing_sku",
        message: `SKU not found for ${asin ? `ASIN "${asin}"` : `ITEM# "${itemCode}"`}. Import WDS Inventory first.`,
        rawValue: asin ?? itemCode,
      });
      continue;
    }

    const amazonPoNumber =
      (row["Amazon PO Number"] ?? row["PO Number"] ?? row["PO#"] ?? row["AMAZON PO"] ?? row["PO"])
        ?.toString().trim() ?? null;

    const qtyRaw = row["Quantity"] ?? row["QTY"] ?? row["Units"] ?? row["Qty Ordered"];
    const quantity = toInt(qtyRaw);
    if (!isPositiveInt(quantity)) {
      errors.push({
        rowNumber: rowNum,
        errorType: "invalid_value",
        fieldName: "Quantity",
        message: `Invalid quantity: "${qtyRaw}". Must be a positive integer.`,
        rawValue: String(qtyRaw ?? ""),
      });
      continue;
    }

    const orderDateRaw = (row["Order Date"] ?? row["ORDER DATE"] ?? row["Date"])?.toString();
    const orderDate = safeParseDate(orderDateRaw);
    if (!orderDate) {
      errors.push({
        rowNumber: rowNum,
        errorType: "invalid_value",
        fieldName: "Order Date",
        message: `Invalid or missing order date: "${orderDateRaw}".`,
        rawValue: String(orderDateRaw ?? ""),
      });
      continue;
    }

    const arrivalRaw = (row["Estimated Arrival Date"] ?? row["Est. Arrival"] ?? row["ETA"] ?? row["Arrival Date"])?.toString();
    const estimatedArrivalDate = arrivalRaw ? safeParseDate(arrivalRaw) : null;

    const statusRaw = (row["Status"] ?? "ordered").toString().trim().toLowerCase().replace(/\s+/g, "_");
    const status: ValidStatus = VALID_STATUSES.includes(statusRaw as ValidStatus)
      ? (statusRaw as ValidStatus)
      : "ordered";

    const factoryName = (row["Factory"] ?? row["Factory Name"] ?? row["FACTORY"])?.toString().trim();
    const factoryId = factoryName ? (factoryByName.get(factoryName.toLowerCase()) ?? null) : null;

    payload.rows.push({
      skuId: sku.id,
      skuCode: sku.skuCode,
      amazonPoNumber: amazonPoNumber || null,
      quantity: quantity!,
      orderDate: orderDate.toISOString(),
      estimatedArrivalDate: estimatedArrivalDate?.toISOString() ?? null,
      status,
      factoryId,
      isDiEligibleUpdate: !sku.isDiEligible,
    });
  }

  return { payload, rowCount: rows.length, willImport: payload.rows.length, willSkip, errors };
}

// ---------- writeFromPayload ----------

async function writeFromPayload(
  db: PrismaClient,
  batchId: string,
  payload: DiOrdersPayload
): Promise<WriteResult> {
  let imported = 0;

  await db.$transaction(async (tx) => {
    for (const row of payload.rows) {
      if (row.amazonPoNumber) {
        const existing = await tx.diOrder.findFirst({
          where: { skuId: row.skuId, amazonPoNumber: row.amazonPoNumber },
        });
        if (existing) {
          await tx.diOrder.update({
            where: { id: existing.id },
            data: {
              quantity: row.quantity,
              orderDate: new Date(row.orderDate),
              estimatedArrivalDate: row.estimatedArrivalDate ? new Date(row.estimatedArrivalDate) : null,
              status: row.status,
              factoryId: row.factoryId,
              importBatchId: batchId,
            },
          });
        } else {
          await tx.diOrder.create({
            data: {
              skuId: row.skuId,
              amazonPoNumber: row.amazonPoNumber,
              quantity: row.quantity,
              orderDate: new Date(row.orderDate),
              estimatedArrivalDate: row.estimatedArrivalDate ? new Date(row.estimatedArrivalDate) : null,
              status: row.status,
              factoryId: row.factoryId,
              importBatchId: batchId,
            },
          });
        }
      } else {
        await tx.diOrder.create({
          data: {
            skuId: row.skuId,
            quantity: row.quantity,
            orderDate: new Date(row.orderDate),
            estimatedArrivalDate: row.estimatedArrivalDate ? new Date(row.estimatedArrivalDate) : null,
            status: row.status,
            factoryId: row.factoryId,
            importBatchId: batchId,
          },
        });
      }

      if (row.isDiEligibleUpdate) {
        await tx.sku.update({ where: { id: row.skuId }, data: { isDiEligible: true } });
      }

      imported++;
    }
  });

  return { rowsImported: imported, rowsSkipped: 0 };
}

// ---------- computeDiff ----------

async function computeDiff(
  db: PrismaClient,
  payload: DiOrdersPayload
): Promise<DiffSummary> {
  if (payload.rows.length === 0) {
    return { totalStagedRows: 0, newRows: 0, updatedRows: 0, unchangedRows: 0, warnings: [] };
  }

  // Check which PO numbers already exist
  const poNumbers = payload.rows
    .map((r) => r.amazonPoNumber)
    .filter((p): p is string => p !== null);

  const existingPos = poNumbers.length
    ? await db.diOrder.findMany({
        where: { amazonPoNumber: { in: poNumbers } },
        select: { skuId: true, amazonPoNumber: true, quantity: true },
      })
    : [];

  const existingKey = (skuId: string, po: string) => `${skuId}|${po}`;
  const existingMap = new Map(existingPos.map((e) => [existingKey(e.skuId, e.amazonPoNumber!), e.quantity]));

  let newRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  const rowDeltas: RowDelta[] = [];

  for (const row of payload.rows) {
    if (!row.amazonPoNumber) {
      // No PO number — always a new insert
      newRows++;
      rowDeltas.push({ skuCode: row.skuCode, previous: null, next: row.quantity, delta: row.quantity });
      continue;
    }
    const prior = existingMap.get(existingKey(row.skuId, row.amazonPoNumber));
    if (prior === undefined) {
      newRows++;
      rowDeltas.push({ skuCode: row.skuCode, previous: null, next: row.quantity, delta: row.quantity });
    } else if (prior === row.quantity) {
      unchangedRows++;
    } else {
      updatedRows++;
      rowDeltas.push({ skuCode: row.skuCode, previous: prior, next: row.quantity, delta: row.quantity - prior });
    }
  }

  const topDeltas = [...rowDeltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20);

  return { totalStagedRows: payload.rows.length, newRows, updatedRows, unchangedRows, topDeltas, warnings: [] };
}

async function runGates(): Promise<GateCheckResult> {
  return { hardFails: [], softFails: [] };
}

export const diOrdersStaging: ProcessorStagingContract<DiOrdersPayload> = {
  parseToPayload,
  writeFromPayload,
  computeDiff,
  runGates,
};
