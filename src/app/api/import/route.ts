// ============================================================================
// API Route: POST /api/import
// ============================================================================
// Handles file upload for all import types.
//
// Request: FormData with:
//   - file: the Excel/CSV file
//   - importType: one of the ImportType enum values
//
// Response: JSON with import summary (rows imported, errors, etc.)
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runImport } from "@/lib/import";
import type { ImportType } from "@/generated/prisma/client";

const VALID_IMPORT_TYPES: ImportType[] = [
  "wds_inventory",
  "wds_monthly_sales",
  "amazon_sales",
  "amazon_vendor_central",
  "amazon_forecast",
  "purchase_orders",
  "asin_mapping",
];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // --- Get import type ---
    const importTypeRaw = formData.get("importType");
    if (!importTypeRaw || typeof importTypeRaw !== "string") {
      return Response.json(
        { error: "Missing importType. Expected one of: " + VALID_IMPORT_TYPES.join(", ") },
        { status: 400 }
      );
    }
    if (!VALID_IMPORT_TYPES.includes(importTypeRaw as ImportType)) {
      return Response.json(
        { error: `Invalid importType "${importTypeRaw}". Expected one of: ${VALID_IMPORT_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    const importType = importTypeRaw as ImportType;

    // --- Get file ---
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return Response.json(
        { error: "Missing file. Upload an Excel (.xlsx) or CSV file." },
        { status: 400 }
      );
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".csv") && !fileName.endsWith(".xls")) {
      return Response.json(
        { error: `Unsupported file type. Upload .xlsx, .xls, or .csv files.` },
        { status: 400 }
      );
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // --- Run the import ---
    const result = await runImport(db, {
      buffer,
      fileName: file.name,
      importType,
    });

    // Determine HTTP status
    const httpStatus =
      result.rowsImported === 0 && result.rowsErrored > 0 ? 422 : 200;

    return Response.json(
      {
        success: result.rowsImported > 0,
        summary: {
          batchId: result.batchId,
          importType: result.importType,
          fileName: result.fileName,
          rowCount: result.rowCount,
          rowsImported: result.rowsImported,
          rowsSkipped: result.rowsSkipped,
          rowsErrored: result.rowsErrored,
        },
        errors:
          result.errors.length > 0
            ? result.errors.map((e) => ({
                row: e.rowNumber,
                field: e.fieldName,
                type: e.errorType,
                message: e.message,
                value: e.rawValue,
              }))
            : [],
      },
      { status: httpStatus }
    );
  } catch (err) {
    console.error("Import failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Import failed unexpectedly" },
      { status: 500 }
    );
  }
}
