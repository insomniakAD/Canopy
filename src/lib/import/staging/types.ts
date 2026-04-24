// ============================================================================
// Staging Framework — Shared Types
// ============================================================================
// Contract each processor implements so imports can be previewed as a diff
// before the user commits them. See orchestrator.ts for the lifecycle.
// ============================================================================

import type { PrismaClient, ImportType } from "@/generated/prisma/client";
import type { ImportErrorDetail } from "../types";

/** What a processor knows about how to handle its own imports. */
export interface ProcessorStagingContract<P> {
  /** Parse + validate the file. MUST NOT write to target tables. */
  parseToPayload(db: PrismaClient, input: ProcessorInput): Promise<ParseResult<P>>;

  /** Apply the staged payload to target tables. Run under commit. */
  writeFromPayload(db: PrismaClient, batchId: string, payload: P): Promise<WriteResult>;

  /** Compare the parsed payload against current DB state. */
  computeDiff(db: PrismaClient, payload: P): Promise<DiffSummary>;

  /** Processor-specific hard/soft gate checks. Shared gates are applied separately. */
  runGates?(db: PrismaClient, payload: P, parseResult: ParseResult<P>): Promise<GateCheckResult>;
}

/** Input to a processor's parseToPayload. Holds buffer + parsed rows for convenience. */
export interface ProcessorInput {
  buffer: Buffer;
  fileName: string;
  /** Parsed spreadsheet header row — empty for raw-buffer processors. */
  headers: string[];
  /** Parsed spreadsheet rows — empty for raw-buffer processors. */
  rows: import("../types").SpreadsheetRow[];
  /** Today, at local midnight — used as the default snapshot date. */
  today: Date;
}

/** Result of parseToPayload. */
export interface ParseResult<P> {
  payload: P;
  /** Rows read from the file. */
  rowCount: number;
  /** Rows that will be written on commit (what `rowsImported` will become). */
  willImport: number;
  /** Rows deliberately not written (blanks, zeros, assembly types, etc.). */
  willSkip: number;
  /** Parse / validation errors. */
  errors: ImportErrorDetail[];
}

/** Result of writeFromPayload — actual rows written. */
export interface WriteResult {
  rowsImported: number;
  rowsSkipped: number;
  /** Additional errors found at write time (rare — most should surface in parse). */
  errors?: ImportErrorDetail[];
}

/** Hard fails block commit. Soft fails only warn. */
export interface GateCheckResult {
  hardFails: GateCheck[];
  softFails: GateCheck[];
}

export interface GateCheck {
  /** Stable code for telemetry / i18n. */
  code: string;
  /** Human-readable message for the preview UI. */
  message: string;
  /** Optional count of rows affected. */
  count?: number;
  /** Optional sample of offending values. */
  samples?: string[];
}

/** What the user sees before committing. Rendered by the diff preview UI. */
export interface DiffSummary {
  /** Total rows in the staged payload. */
  totalStagedRows: number;
  /** Rows that would be newly inserted. */
  newRows: number;
  /** Existing rows that would be updated. */
  updatedRows: number;
  /** Existing rows that would be written identically. */
  unchangedRows: number;
  /**
   * Optional period-level roll-up (for Sales / Forecast / Inventory).
   * Each entry compares sum-per-period before vs. after.
   */
  periodTotals?: PeriodTotal[];
  /** Top N rows with the biggest absolute deltas. */
  topDeltas?: RowDelta[];
  /** Auxiliary warnings to surface in the UI (soft fails are here too). */
  warnings: GateCheck[];
}

export interface PeriodTotal {
  /** Display label, e.g. "Mar 2025" or "Week 12 (Apr 7)". */
  period: string;
  previousTotal: number;
  newTotal: number;
  delta: number;
  /** null if previous total was 0. */
  deltaPct: number | null;
}

export interface RowDelta {
  skuCode: string;
  /** Optional period label (for time-series data). */
  period?: string;
  /** null if this row is a new insert. */
  previous: number | null;
  next: number;
  delta: number;
}

/** Envelope stored in ImportBatch.stagedPayload. */
export interface StagedPayloadEnvelope<P = unknown> {
  version: 1;
  importType: ImportType;
  data: P;
}
