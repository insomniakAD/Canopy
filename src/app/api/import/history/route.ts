// ============================================================================
// API Route: GET /api/import/history
// ============================================================================
// Returns recent import batches with their status and error summaries.
// Used by the UI to show import history and allow users to review errors.
// ============================================================================

import { db } from "@/lib/db";

export async function GET() {
  const batches = await db.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      errors: {
        take: 10, // Show first 10 errors per batch
        orderBy: { rowNumber: "asc" },
      },
      uploadedBy: {
        select: { name: true, email: true },
      },
    },
  });

  return Response.json({
    batches: batches.map((b) => ({
      id: b.id,
      importType: b.importType,
      fileName: b.fileName,
      status: b.status,
      rowCount: b.rowCount,
      rowsImported: b.rowsImported,
      rowsSkipped: b.rowsSkipped,
      rowsErrored: b.rowsErrored,
      errorSummary: b.errorSummary,
      uploadedBy: b.uploadedBy?.name ?? null,
      createdAt: b.createdAt,
      completedAt: b.completedAt,
      errors: b.errors.map((e) => ({
        row: e.rowNumber,
        field: e.fieldName,
        type: e.errorType,
        message: e.errorMessage,
        value: e.rawValue,
      })),
    })),
  });
}
