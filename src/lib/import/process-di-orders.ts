// ============================================================================
// DI Orders Import Processor
// ============================================================================
// Processes Amazon Direct Import purchase orders.
// DI orders go from Amazon to Winsome's overseas factories — inventory never
// touches Woodinville warehouse.
//
// Expected columns:
//   - ASIN or ITEM# (to identify the SKU)
//   - Amazon PO Number
//   - Quantity (units ordered)
//   - Order Date
//   - Estimated Arrival Date (optional)
//   - Status (optional — defaults to "ordered")
//   - Factory Name (optional — used to link to factory record)
//
// Why this matters:
//   1. Amazon's 1P PO quantities may be smaller when DI orders are in pipeline
//   2. If DI is paused (e.g., tariffs), all volume shifts to 1P/DF via Woodinville
//   3. DI order cadence per SKU helps predict when Amazon will reorder
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow } from "./types";
import { parseFlexibleDate, isPositiveInt, toInt } from "./utils";

/** Safely parse a date string, returning null instead of throwing. */
function safeParseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  try {
    return parseFlexibleDate(value.toString());
  } catch {
    return null;
  }
}

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

/**
 * Process a DI Orders import file.
 */
export async function processDiOrders(
  db: PrismaClient,
  rows: SpreadsheetRow[],
  batchId: string
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let rowsImported = 0;
  let rowsSkipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +2 for header row + 1-indexed

    // --- Identify the SKU ---
    const asin = row["ASIN"]?.toString().trim();
    const itemCode = (row["ITEM#"] ?? row["ITEM"] ?? row["SKU"])?.toString().trim();

    if (!asin && !itemCode) {
      errors.push({
        rowNumber: rowNum,
        errorType: "format_error",
        message: "Row must have either ASIN or ITEM# to identify the SKU.",
      });
      continue;
    }

    // Look up SKU
    let sku = null;
    if (asin) {
      sku = await db.sku.findUnique({ where: { asin } });
    }
    if (!sku && itemCode) {
      sku = await db.sku.findUnique({ where: { skuCode: itemCode } });
    }

    if (!sku) {
      errors.push({
        rowNumber: rowNum,
        errorType: "missing_sku",
        message: `SKU not found for ${asin ? `ASIN "${asin}"` : `ITEM# "${itemCode}"`}. Import WDS Inventory first.`,
        rawValue: asin ?? itemCode,
      });
      continue;
    }

    // --- Amazon PO Number ---
    const amazonPoNumber = (
      row["Amazon PO Number"] ??
      row["PO Number"] ??
      row["PO#"] ??
      row["AMAZON PO"] ??
      row["PO"]
    )?.toString().trim();

    // --- Quantity ---
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

    // --- Order Date ---
    const orderDateRaw = row["Order Date"] ?? row["ORDER DATE"] ?? row["Date"];
    const orderDate = safeParseDate(orderDateRaw?.toString());

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

    // --- Estimated Arrival Date (optional) ---
    const arrivalRaw =
      row["Estimated Arrival Date"] ??
      row["Est. Arrival"] ??
      row["ETA"] ??
      row["Arrival Date"];
    const estimatedArrivalDate = arrivalRaw ? safeParseDate(arrivalRaw.toString()) : null;

    // --- Status (optional, defaults to "ordered") ---
    const statusRaw = (row["Status"] ?? "ordered").toString().trim().toLowerCase().replace(/\s+/g, "_");
    const status = VALID_STATUSES.includes(statusRaw as ValidStatus)
      ? (statusRaw as ValidStatus)
      : "ordered";

    // --- Factory (optional) ---
    const factoryName = (row["Factory"] ?? row["Factory Name"] ?? row["FACTORY"])?.toString().trim();
    let factoryId: string | null = null;
    if (factoryName) {
      const factory = await db.factory.findFirst({
        where: { name: { equals: factoryName, mode: "insensitive" } },
      });
      if (factory) factoryId = factory.id;
    }

    // --- Upsert DI Order ---
    // If same SKU + Amazon PO number exists, update it; otherwise create
    if (amazonPoNumber) {
      const existing = await db.diOrder.findFirst({
        where: { skuId: sku.id, amazonPoNumber },
      });

      if (existing) {
        await db.diOrder.update({
          where: { id: existing.id },
          data: {
            quantity: quantity!,
            orderDate,
            estimatedArrivalDate,
            status,
            factoryId,
            importBatchId: batchId,
          },
        });
      } else {
        await db.diOrder.create({
          data: {
            skuId: sku.id,
            amazonPoNumber,
            quantity: quantity!,
            orderDate,
            estimatedArrivalDate,
            status,
            factoryId,
            importBatchId: batchId,
          },
        });
      }
    } else {
      // No PO number — just create (can't dedup without it)
      await db.diOrder.create({
        data: {
          skuId: sku.id,
          quantity: quantity!,
          orderDate,
          estimatedArrivalDate,
          status,
          factoryId,
          importBatchId: batchId,
        },
      });
    }

    // Mark SKU as DI-eligible (it clearly is, since it has DI orders)
    if (!sku.isDiEligible) {
      await db.sku.update({
        where: { id: sku.id },
        data: { isDiEligible: true },
      });
    }

    rowsImported++;
  }

  return {
    batchId,
    importType: "di_orders",
    fileName: "",
    rowCount: rows.length,
    rowsImported,
    rowsSkipped,
    rowsErrored: errors.length,
    errors,
  };
}
