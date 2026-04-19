// ============================================================================
// Import Processor: Purchase Orders (from WDS)
// ============================================================================
// Expected columns (WDS fixed report format):
//   PO Number, ITEM#, Quantity Ordered, Quantity Received,
//   Vendor/Factory, Status, Order Date, Estimated Arrival, Unit Cost
//
// Behavior: UPSERT — existing PO numbers are updated, new ones are created.
// Multiple rows with the same PO Number but different ITEM# are treated
// as separate line items within one PO.
// ============================================================================

import type { PrismaClient, PoStatus } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail, SpreadsheetRow } from "./types";
import { parseFlexibleDate, toInt, toNumber } from "./utils";

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

export async function processPurchaseOrders(
  db: PrismaClient,
  rows: SpreadsheetRow[],
  batchId: string
): Promise<ImportSummary> {
  const errors: ImportErrorDetail[] = [];
  let imported = 0;
  let skipped = 0;

  // Group rows by PO number (one PO may have multiple SKU lines)
  const poGroups = new Map<string, { rows: SpreadsheetRow[]; indices: number[] }>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const poNum = row["PO Number"] != null ? String(row["PO Number"]).trim() : "";
    if (!poNum) {
      errors.push({
        rowNumber: i + 2,
        fieldName: "PO Number",
        errorType: "invalid_value",
        message: "PO Number is blank",
      });
      continue;
    }
    if (!poGroups.has(poNum)) {
      poGroups.set(poNum, { rows: [], indices: [] });
    }
    poGroups.get(poNum)!.rows.push(row);
    poGroups.get(poNum)!.indices.push(i);
  }

  // Process each PO group
  for (const [poNum, group] of poGroups) {
    const firstRow = group.rows[0];
    const rowNum = group.indices[0] + 2;

    // --- Parse PO-level fields from first row ---
    const statusRaw = firstRow["Status"]
      ? String(firstRow["Status"]).trim().toLowerCase()
      : "";
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

    // Parse dates
    let orderDate: Date | null = null;
    let estimatedArrival: Date | null = null;
    try {
      if (firstRow["Order Date"]) {
        orderDate = parseFlexibleDate(String(firstRow["Order Date"]));
      }
    } catch {
      errors.push({
        rowNumber: rowNum,
        fieldName: "Order Date",
        errorType: "invalid_value",
        message: `Cannot parse date "${firstRow["Order Date"]}"`,
        rawValue: String(firstRow["Order Date"]),
      });
      continue;
    }
    try {
      if (firstRow["Estimated Arrival"]) {
        estimatedArrival = parseFlexibleDate(String(firstRow["Estimated Arrival"]));
      }
    } catch {
      errors.push({
        rowNumber: rowNum,
        fieldName: "Estimated Arrival",
        errorType: "invalid_value",
        message: `Cannot parse date "${firstRow["Estimated Arrival"]}"`,
        rawValue: String(firstRow["Estimated Arrival"]),
      });
      continue;
    }

    // Look up factory by name
    const factoryName = firstRow["Vendor/Factory"]
      ? String(firstRow["Vendor/Factory"]).trim()
      : firstRow["Factory"]
        ? String(firstRow["Factory"]).trim()
        : "";

    let factoryId: string | null = null;
    if (factoryName) {
      // Try exact match first, then case-insensitive contains
      let factory = await db.factory.findFirst({
        where: { name: factoryName },
      });
      if (!factory) {
        factory = await db.factory.findFirst({
          where: { name: { contains: factoryName, mode: "insensitive" } },
        });
      }
      if (factory) {
        factoryId = factory.id;
      } else {
        errors.push({
          rowNumber: rowNum,
          fieldName: "Vendor/Factory",
          errorType: "invalid_value",
          message: `Factory "${factoryName}" not found. Add the factory to the system first.`,
          rawValue: factoryName,
        });
        continue;
      }
    }

    if (!factoryId) {
      errors.push({
        rowNumber: rowNum,
        fieldName: "Vendor/Factory",
        errorType: "invalid_value",
        message: "Factory/Vendor name is required",
      });
      continue;
    }

    // --- Upsert the PO ---
    const po = await db.purchaseOrder.upsert({
      where: { poNumber: poNum },
      update: {
        status,
        orderDate,
        estimatedArrivalDate: estimatedArrival,
      },
      create: {
        poNumber: poNum,
        factoryId,
        status,
        orderDate,
        estimatedArrivalDate: estimatedArrival,
      },
    });

    // --- Process each line item ---
    for (let li = 0; li < group.rows.length; li++) {
      const lineRow = group.rows[li];
      const lineRowNum = group.indices[li] + 2;

      const itemCode = lineRow["ITEM#"] != null ? String(lineRow["ITEM#"]).trim() : "";
      if (!itemCode) {
        errors.push({
          rowNumber: lineRowNum,
          fieldName: "ITEM#",
          errorType: "invalid_value",
          message: "ITEM# is blank on PO line",
        });
        continue;
      }

      const sku = await db.sku.findUnique({ where: { skuCode: itemCode } });
      if (!sku) {
        errors.push({
          rowNumber: lineRowNum,
          fieldName: "ITEM#",
          errorType: "missing_sku",
          message: `SKU "${itemCode}" not found in the system`,
          rawValue: itemCode,
        });
        continue;
      }

      const qtyOrdered = toInt(lineRow["Quantity Ordered"]);
      if (!qtyOrdered || qtyOrdered <= 0) {
        errors.push({
          rowNumber: lineRowNum,
          fieldName: "Quantity Ordered",
          errorType: "invalid_value",
          message: `Quantity Ordered "${lineRow["Quantity Ordered"]}" is not valid`,
          rawValue: String(lineRow["Quantity Ordered"] ?? ""),
        });
        continue;
      }

      const qtyReceived = toInt(lineRow["Quantity Received"]) ?? 0;
      const unitCost = toNumber(lineRow["Unit Cost"]);

      // Check if line item already exists for this PO + SKU
      const existingLine = await db.poLineItem.findFirst({
        where: { poId: po.id, skuId: sku.id },
      });

      if (existingLine) {
        await db.poLineItem.update({
          where: { id: existingLine.id },
          data: { quantityOrdered: qtyOrdered, quantityReceived: qtyReceived, unitCostUsd: unitCost },
        });
      } else {
        await db.poLineItem.create({
          data: {
            poId: po.id,
            skuId: sku.id,
            quantityOrdered: qtyOrdered,
            quantityReceived: qtyReceived,
            unitCostUsd: unitCost,
          },
        });
      }

      // Auto-consume a pending vendor transition if this PO matches it.
      // A PO landing on the new vendor confirms the switch: apply the
      // captured new cost/MOQ/FCL quantities to the SKU, move defaultFactory,
      // and flip the transition to "consumed".
      const pending = await db.pendingVendorTransition.findFirst({
        where: {
          skuId: sku.id,
          status: "pending",
          toFactoryId: po.factoryId,
        },
      });
      if (pending) {
        const skuUpdate: Record<string, unknown> = {
          defaultFactoryId: po.factoryId,
        };
        if (pending.newUnitCost != null) skuUpdate.unitCostUsd = pending.newUnitCost;
        if (pending.newMoq != null) skuUpdate.moq = pending.newMoq;
        if (pending.newFclQty40GP != null) skuUpdate.fclQty40GP = pending.newFclQty40GP;
        if (pending.newFclQty40HQ != null) skuUpdate.fclQty40HQ = pending.newFclQty40HQ;
        await db.sku.update({ where: { id: sku.id }, data: skuUpdate });
        await db.pendingVendorTransition.update({
          where: { id: pending.id },
          data: { status: "consumed" },
        });
      }

      imported++;
    }
  }

  return {
    batchId,
    importType: "purchase_orders",
    fileName: "",
    rowCount: rows.length,
    rowsImported: imported,
    rowsSkipped: skipped,
    rowsErrored: errors.length,
    errors,
  };
}
