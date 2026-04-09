// ============================================================================
// Import Orchestrator
// ============================================================================
// Central entry point for all file imports.
// Handles: file hashing, duplicate detection, batch creation,
// routing to the correct processor, error logging, batch completion.
//
// Usage:
//   const result = await runImport(db, file, importType);
//   // result.rowsImported, result.errors, etc.
// ============================================================================

import type { PrismaClient, ImportType } from "@/generated/prisma/client";
import type { ImportSummary, ImportErrorDetail } from "./types";
import { hashFileBuffer, parseSpreadsheet, parseAmazonMeta } from "./utils";
import { processWdsInventory } from "./process-wds-inventory";
import { processWdsMonthlySales } from "./process-wds-monthly-sales";
import { processAmazonSales } from "./process-amazon-sales";
import { processAmazonVendorCentral } from "./process-amazon-vendor-central";
import { processAmazonForecast } from "./process-amazon-forecast";
import { processAsinMapping } from "./process-asin-mapping";
import { processPurchaseOrders } from "./process-purchase-orders";
import { processDiOrders } from "./process-di-orders";

export interface ImportRequest {
  buffer: Buffer;
  fileName: string;
  importType: ImportType;
  uploadedById?: string;
}

export async function runImport(
  db: PrismaClient,
  request: ImportRequest
): Promise<ImportSummary> {
  const { buffer, fileName, importType, uploadedById } = request;

  // --- Step 1: Check for duplicate file ---
  const fileHash = hashFileBuffer(buffer);
  const existingBatch = await db.importBatch.findFirst({
    where: { fileHash, status: "completed" },
  });
  if (existingBatch) {
    const when = existingBatch.createdAt.toLocaleDateString();
    return {
      batchId: existingBatch.id,
      importType,
      fileName,
      rowCount: 0,
      rowsImported: 0,
      rowsSkipped: 0,
      rowsErrored: 1,
      errors: [
        {
          rowNumber: 0,
          errorType: "duplicate",
          message: `This exact file was already uploaded on ${when}. File: "${existingBatch.fileName}".`,
        },
      ],
    };
  }

  // --- Step 2: Create import batch record ---
  const batch = await db.importBatch.create({
    data: {
      importType,
      fileName,
      fileHash,
      status: "processing",
      uploadedById: uploadedById ?? null,
    },
  });

  try {
    // --- Step 3: Parse the file and route to correct processor ---
    let result: ImportSummary;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Amazon reports have metadata in row 0, headers in row 1
    const isAmazonReport = [
      "amazon_sales",
      "amazon_vendor_central",
      "amazon_forecast",
    ].includes(importType);

    const headerRow = isAmazonReport ? 1 : 0;
    const { headers, rows } = parseSpreadsheet(buffer, fileName, { headerRow });

    switch (importType) {
      case "wds_inventory":
        result = await processWdsInventory(db, rows, batch.id, today);
        break;

      case "wds_monthly_sales":
        result = await processWdsMonthlySales(db, headers, rows, batch.id);
        break;

      case "amazon_sales": {
        const meta = parseAmazonMeta(buffer);
        result = await processAmazonSales(db, rows, batch.id, meta);
        break;
      }

      case "amazon_vendor_central":
        result = await processAmazonVendorCentral(db, rows, batch.id, today);
        break;

      case "amazon_forecast":
        result = await processAmazonForecast(db, headers, rows, batch.id, today);
        break;

      case "asin_mapping":
        result = await processAsinMapping(db, rows, batch.id);
        break;

      case "purchase_orders":
        result = await processPurchaseOrders(db, rows, batch.id);
        break;

      case "di_orders":
        result = await processDiOrders(db, rows, batch.id);
        break;

      default:
        throw new Error(`Unknown import type: ${importType}`);
    }

    // --- Step 4: Log errors to database ---
    if (result.errors.length > 0) {
      await db.importError.createMany({
        data: result.errors.map((e: ImportErrorDetail) => ({
          batchId: batch.id,
          rowNumber: e.rowNumber,
          fieldName: e.fieldName ?? null,
          errorType: e.errorType,
          errorMessage: e.message,
          rawValue: e.rawValue ?? null,
        })),
      });
    }

    // --- Step 5: Update batch with results ---
    await db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: result.rowsErrored > 0 && result.rowsImported === 0 ? "failed" : "completed",
        rowCount: result.rowCount,
        rowsImported: result.rowsImported,
        rowsSkipped: result.rowsSkipped,
        rowsErrored: result.rowsErrored,
        errorSummary:
          result.errors.length > 0
            ? `${result.rowsErrored} errors: ${summarizeErrors(result.errors)}`
            : null,
        completedAt: new Date(),
      },
    });

    result.batchId = batch.id;
    result.fileName = fileName;
    return result;
  } catch (err) {
    // Mark batch as failed
    await db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "failed",
        errorSummary: err instanceof Error ? err.message : "Unknown error",
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

/** Create a short summary of error types for the batch record */
function summarizeErrors(errors: ImportErrorDetail[]): string {
  const counts: Record<string, number> = {};
  for (const e of errors) {
    counts[e.errorType] = (counts[e.errorType] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
}
