// ============================================================================
// Import Pipeline — Shared Types
// ============================================================================

import { ImportType } from "@/generated/prisma/client";

/** Result of processing a single row during import */
export type RowResult =
  | { status: "imported" }
  | { status: "skipped"; reason: string }
  | { status: "error"; rowNumber: number; fieldName?: string; errorType: ImportErrorKind; message: string; rawValue?: string };

export type ImportErrorKind = "missing_sku" | "invalid_value" | "duplicate" | "format_error" | "unmapped_asin";

/** Summary returned after an import completes */
export interface ImportSummary {
  batchId: string;
  importType: ImportType;
  fileName: string;
  rowCount: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsErrored: number;
  errors: ImportErrorDetail[];
}

export interface ImportErrorDetail {
  rowNumber: number;
  fieldName?: string;
  errorType: ImportErrorKind;
  message: string;
  rawValue?: string;
}

/** Metadata parsed from Amazon report header row */
export interface AmazonReportMeta {
  reportDateRange?: { start: Date; end: Date };
  reportUpdated?: Date;
  forecastStatistic?: string;
}

/** A single row from any parsed spreadsheet — keys are column headers */
export type SpreadsheetRow = Record<string, string | number | null | undefined>;
