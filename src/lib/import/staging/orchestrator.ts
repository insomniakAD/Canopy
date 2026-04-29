// ============================================================================
// Staging Orchestrator
// ============================================================================
// Lifecycle:
//   stageImport()   — parse + validate + diff. Never writes target tables.
//   commitStaged()  — apply the staged payload to target tables.
//   cancelStaged()  — discard a staged batch without writing.
//
// Buyers call stage → preview → commit/cancel. Each staged batch auto-cancels
// any prior staged batch of the same (importType, uploadedById) so users
// don't accumulate zombie drafts.
// ============================================================================

import type { PrismaClient, ImportType } from "@/generated/prisma/client";
import { hashFileBuffer, parseSpreadsheet, parseAmazonMeta } from "../utils";
import type { ImportErrorDetail, SpreadsheetRow } from "../types";
import { getProcessor } from "./registry";
import { runSharedGates, mergeGates } from "./gates";
import type {
  ProcessorInput,
  StagedPayloadEnvelope,
  DiffSummary,
  GateCheckResult,
} from "./types";

export interface StageRequest {
  buffer: Buffer;
  fileName: string;
  importType: ImportType;
  uploadedById?: string;
}

export interface StageResult {
  batchId: string;
  importType: ImportType;
  fileName: string;
  rowCount: number;
  willImport: number;
  willSkip: number;
  parseErrors: ImportErrorDetail[];
  gates: GateCheckResult;
  diff: DiffSummary | null;
  /** True when hard-fails prevented diff/staging. */
  blocked: boolean;
}

/**
 * Stage an import: parse the file, validate, compute diff, persist the payload.
 * Does NOT write to target tables.
 */
export async function stageImport(
  db: PrismaClient,
  request: StageRequest
): Promise<StageResult> {
  const { buffer, fileName, importType, uploadedById } = request;
  const processor = getProcessor(importType);

  // ---- Auto-cancel prior staged batches of the same (type, user) ----
  // Keeps the "you have a pending upload" state from accumulating.
  await db.importBatch.updateMany({
    where: {
      importType,
      stagingStatus: "staged",
      uploadedById: uploadedById ?? null,
    },
    data: {
      stagingStatus: "cancelled",
      stagedPayload: undefined,
      diffSummary: undefined,
      completedAt: new Date(),
    },
  });

  // ---- Create the new staged batch record ----
  const fileHash = hashFileBuffer(buffer);
  const batch = await db.importBatch.create({
    data: {
      importType,
      fileName,
      fileHash,
      status: "processing",
      stagingStatus: "staged",
      uploadedById: uploadedById ?? null,
    },
  });

  try {
    // ---- Parse the spreadsheet if applicable (some processors handle the raw buffer) ----
    const { headers, rows } = prepareSpreadsheet(buffer, fileName, importType);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const input: ProcessorInput = { buffer, fileName, headers, rows, today };
    const parseResult = await processor.parseToPayload(db, input);

    // ---- Run shared + processor gate checks ----
    const sharedGates = runSharedGates(parseResult);
    const processorGates = processor.runGates
      ? await processor.runGates(db, parseResult.payload, parseResult)
      : { hardFails: [], softFails: [] };
    const gates = mergeGates(sharedGates, processorGates);

    const blocked = gates.hardFails.length > 0;

    // ---- If blocked, record errors + gates and bail before computing diff ----
    if (blocked) {
      await db.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "failed",
          rowCount: parseResult.rowCount,
          rowsErrored: parseResult.errors.length,
          errorSummary: gates.hardFails.map((g) => g.message).join(" | "),
          diffSummary: {
            totalStagedRows: 0,
            newRows: 0,
            updatedRows: 0,
            unchangedRows: 0,
            warnings: [],
            blockers: gates.hardFails,
          } as unknown as object,
          completedAt: new Date(),
        },
      });

      return {
        batchId: batch.id,
        importType,
        fileName,
        rowCount: parseResult.rowCount,
        willImport: 0,
        willSkip: parseResult.willSkip,
        parseErrors: parseResult.errors,
        gates,
        diff: null,
        blocked: true,
      };
    }

    // ---- Compute diff against current DB state ----
    const diff = await processor.computeDiff(db, parseResult.payload);
    // Surface soft fails in the diff warnings list for the UI
    diff.warnings = [...diff.warnings, ...gates.softFails];

    // ---- Persist payload + diff ----
    const envelope: StagedPayloadEnvelope = {
      version: 1,
      importType,
      data: parseResult.payload,
    };

    await db.importBatch.update({
      where: { id: batch.id },
      data: {
        stagedPayload: envelope as unknown as object,
        diffSummary: diff as unknown as object,
        rowCount: parseResult.rowCount,
        rowsErrored: parseResult.errors.length,
      },
    });

    // ---- Log parse errors to ImportError (for inspection in history) ----
    if (parseResult.errors.length > 0) {
      await db.importError.createMany({
        data: parseResult.errors.map((e) => ({
          batchId: batch.id,
          rowNumber: e.rowNumber,
          fieldName: e.fieldName ?? null,
          errorType: e.errorType,
          errorMessage: e.message,
          rawValue: e.rawValue ?? null,
        })),
      });
    }

    return {
      batchId: batch.id,
      importType,
      fileName,
      rowCount: parseResult.rowCount,
      willImport: parseResult.willImport,
      willSkip: parseResult.willSkip,
      parseErrors: parseResult.errors,
      gates,
      diff,
      blocked: false,
    };
  } catch (err) {
    await db.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "failed",
        stagingStatus: "cancelled",
        errorSummary: err instanceof Error ? err.message : "Unknown error during staging",
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

/**
 * Commit a previously staged batch: apply the payload to target tables.
 */
export async function commitStaged(
  db: PrismaClient,
  batchId: string
): Promise<{
  batchId: string;
  importType: ImportType;
  rowsImported: number;
  rowsSkipped: number;
}> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) {
    throw new Error(`Import batch ${batchId} not found`);
  }
  if (batch.stagingStatus !== "staged") {
    throw new Error(
      `Batch ${batchId} is not in 'staged' state (current: ${batch.stagingStatus ?? "legacy"})`
    );
  }
  if (!batch.stagedPayload) {
    throw new Error(`Batch ${batchId} has no staged payload`);
  }

  const envelope = batch.stagedPayload as unknown as StagedPayloadEnvelope;
  if (envelope.importType !== batch.importType) {
    throw new Error(
      `Staged payload type mismatch: batch=${batch.importType}, payload=${envelope.importType}`
    );
  }

  const processor = getProcessor(batch.importType);
  const write = await processor.writeFromPayload(db, batch.id, envelope.data);

  await db.importBatch.update({
    where: { id: batch.id },
    data: {
      status: "completed",
      stagingStatus: "committed",
      rowsImported: write.rowsImported,
      rowsSkipped: (batch.rowsSkipped ?? 0) + write.rowsSkipped,
      // Clear the payload now that it's been applied — diff summary stays for audit trail.
      stagedPayload: undefined,
      completedAt: new Date(),
    },
  });

  return {
    batchId: batch.id,
    importType: batch.importType,
    rowsImported: write.rowsImported,
    rowsSkipped: write.rowsSkipped,
  };
}

/**
 * Cancel a staged batch: clear payload, mark cancelled. No target writes.
 */
export async function cancelStaged(
  db: PrismaClient,
  batchId: string
): Promise<{ batchId: string; importType: ImportType }> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error(`Import batch ${batchId} not found`);
  if (batch.stagingStatus !== "staged") {
    throw new Error(
      `Batch ${batchId} is not in 'staged' state (current: ${batch.stagingStatus ?? "legacy"})`
    );
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: {
      stagingStatus: "cancelled",
      stagedPayload: undefined,
      status: "completed",
      completedAt: new Date(),
    },
  });

  return { batchId: batch.id, importType: batch.importType };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Parse the spreadsheet into headers + rows for processors that need them.
 * Mirrors the parsing branches from the legacy orchestrator so we stay
 * compatible with the existing per-processor row shapes.
 */
function prepareSpreadsheet(
  buffer: Buffer,
  fileName: string,
  importType: ImportType
): { headers: string[]; rows: SpreadsheetRow[] } {
  // Raw-buffer processors don't use header-based parsing upfront.
  const rawBufferTypes: ImportType[] = [
    "wds_active_items",
    "wds_inventory",
    "kit_composition",
    "asin_mapping",
    "item_update",
  ];
  if (rawBufferTypes.includes(importType)) {
    return { headers: [], rows: [] };
  }

  const isAmazonReport = importType === "amazon_sales" || importType === "amazon_forecast";
  const isWdsMonthly = importType === "wds_monthly_sales" || importType === "wds_monthly_cartons";
  const headerRow = isAmazonReport || isWdsMonthly ? 1 : 0;
  const parsed = parseSpreadsheet(buffer, fileName, { headerRow });
  return { headers: parsed.headers, rows: parsed.rows };
}

/** Exposed so processors can read Amazon report metadata. */
export { parseAmazonMeta };
