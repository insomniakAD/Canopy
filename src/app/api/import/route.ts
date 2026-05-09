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
import { stageImport } from "@/lib/import/staging/orchestrator";
import { usesStaging } from "@/lib/import/staging/registry";
import { auth } from "@/auth";
import type { ImportType } from "@/generated/prisma/client";

// Manual-upload allowlist. WDS data (inventory, monthly sales, factory POs,
// pitem, parthist-daily) flows through Admin → Live Sync now. Amazon types
// stay here until Golf's Vendor Central API arrives. SKU-definition types
// (active_items, item_update, kit_composition, asin_mapping) live under
// /admin/uploads but share this endpoint.
const VALID_IMPORT_TYPES: ImportType[] = [
  "wds_active_items",
  "amazon_sales",
  "amazon_vendor_central",
  "amazon_forecast",
  "asin_mapping",
  "di_orders",
  "kit_composition",
  "item_update",
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
    // STKSTATUS (wds_inventory) is a plain-text Oracle report (.txt).
    const fileName = file.name.toLowerCase();
    const allowedExts = [".xlsx", ".xls", ".csv", ".txt"];
    if (!allowedExts.some((ext) => fileName.endsWith(ext))) {
      return Response.json(
        { error: `Unsupported file type. Upload .xlsx, .xls, .csv, or .txt files.` },
        { status: 400 }
      );
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Look up the uploader for batch attribution + auto-cancel scoping.
    // Verify the user exists before passing the ID — a stale session after a
    // DB reset would otherwise cause a FK violation on import_batches.
    const session = await auth();
    const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
    const uploadedById = sessionUserId
      ? (await db.user.findUnique({ where: { id: sessionUserId }, select: { id: true } }))?.id
      : undefined;

    // --- New flow (Layer 3): import types registered for staging go through
    // the two-phase preview → commit path. Other types still use the legacy
    // direct-commit path until Commit 2b migrates them. ---
    if (usesStaging(importType)) {
      const stage = await stageImport(db, {
        buffer,
        fileName: file.name,
        importType,
        uploadedById,
      });

      const httpStatus = stage.blocked ? 422 : 200;
      return Response.json(
        {
          mode: "staged",
          batchId: stage.batchId,
          importType: stage.importType,
          fileName: stage.fileName,
          blocked: stage.blocked,
          summary: {
            rowCount: stage.rowCount,
            willImport: stage.willImport,
            willSkip: stage.willSkip,
            errorCount: stage.parseErrors.length,
          },
          gates: stage.gates,
          diff: stage.diff,
          errors: stage.parseErrors.map((e) => ({
            row: e.rowNumber,
            field: e.fieldName,
            type: e.errorType,
            message: e.message,
            value: e.rawValue,
          })),
        },
        { status: httpStatus }
      );
    }

    // --- Legacy direct-commit path (unchanged) ---
    const result = await runImport(db, {
      buffer,
      fileName: file.name,
      importType,
      uploadedById,
    });

    // Determine HTTP status
    const httpStatus =
      result.rowsImported === 0 && result.rowsErrored > 0 ? 422 : 200;

    return Response.json(
      {
        mode: "direct",
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
