// ============================================================================
// API: POST /api/blob/sync
// ============================================================================
// Three actions, all via POST:
//
//   preview  — Download blob(s), parse, compute diff, stage. Creates
//              ImportBatch (stagingStatus=staged) and BlobSync (status=preview).
//              Returns the same diff/errors shape as the manual import API so
//              the DiffPreview component works unchanged.
//
//   apply    — Commit a previewed batch. Writes staged payload to target
//              tables; marks BlobSync applied.
//
//   cancel   — Discard a previewed batch without writing. Marks BlobSync
//              cancelled.

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { fetchBlobJson, fetchBlobsJson } from "@/lib/blob/source";
import {
  getBlobSource,
  canonicalPathname,
  type BlobSourceDefinition,
} from "@/lib/blob/registry";
import { parseOitemMonthlyBlob } from "@/lib/import/processors/blob-monthly-sales";
import { parseBlobPurchaseOrders } from "@/lib/import/processors/blob-purchase-orders";
import { commitStaged, cancelStaged } from "@/lib/import/staging/orchestrator";
import { runSharedGates, mergeGates } from "@/lib/import/staging/gates";
import { computeMonthlySalesDiff } from "@/lib/import/processors/wds-monthly-sales-staging";
import { computePurchaseOrdersDiff } from "@/lib/import/processors/purchase-orders-staging";
import { createHash } from "crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ParseResult, DiffSummary, StagedPayloadEnvelope } from "@/lib/import/staging/types";

// ----------------------------------------------------------------------------
// Per-source dispatchers
// ----------------------------------------------------------------------------
// Each dispatcher knows how to fetch + parse its blob(s) and how to compute
// the source-specific diff. The route shell handles batch creation, gates,
// persistence, and response shaping uniformly.

interface SourceDispatcher {
  fetchAndParse(db: PrismaClient): Promise<ParseResult<unknown>>;
  computeDiff(db: PrismaClient, payload: unknown): Promise<DiffSummary>;
}

function dispatcherFor(source: BlobSourceDefinition): SourceDispatcher {
  switch (source.key) {
    case "oitem-monthly":
      return {
        fetchAndParse: async (d) => {
          const blob = await fetchBlobJson(source.pathnames[0]);
          return parseOitemMonthlyBlob(d, blob);
        },
        computeDiff: (d, payload) =>
          computeMonthlySalesDiff(d, payload as Parameters<typeof computeMonthlySalesDiff>[1]),
      };

    case "purchase-orders":
      return {
        fetchAndParse: async (d) => {
          const blobs = await fetchBlobsJson(source.pathnames);
          const porder = blobs.get("porder-recent.json");
          const contdet = blobs.get("cont-det.json");
          if (!porder || !contdet) {
            throw new Error("Missing porder-recent.json or cont-det.json in blob storage");
          }
          return parseBlobPurchaseOrders(d, { porder, contdet });
        },
        computeDiff: (d, payload) =>
          computePurchaseOrdersDiff(d, payload as Parameters<typeof computePurchaseOrdersDiff>[1]),
      };
  }
}

// ----------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = (session.user as { id?: string }).id;

    const body = await request.json() as Record<string, unknown>;
    const action = body.action;

    // ------------------------------------------------------------------ //
    // PREVIEW
    // ------------------------------------------------------------------ //
    if (action === "preview") {
      const key = body.key;
      if (typeof key !== "string") {
        return Response.json({ error: "Missing key" }, { status: 400 });
      }

      const source = getBlobSource(key);
      if (!source) {
        return Response.json({ error: `Unknown blob source: "${key}"` }, { status: 400 });
      }

      const dispatcher = dispatcherFor(source);
      const fileName = source.pathnames.join(" + ");
      const canonical = canonicalPathname(source);

      // Fetch + parse via the source-specific dispatcher
      const parseResult = await dispatcher.fetchAndParse(db);

      // Gates
      const sharedGates = runSharedGates(parseResult);
      const gates = mergeGates(sharedGates, { hardFails: [], softFails: [] });
      const blocked = gates.hardFails.length > 0;

      // Auto-cancel any existing staged batch of the same import type
      await db.importBatch.updateMany({
        where: {
          importType: source.importType,
          stagingStatus: "staged",
          uploadedById: userId ?? null,
        },
        data: {
          stagingStatus: "cancelled",
          stagedPayload: undefined,
          completedAt: new Date(),
        },
      });

      // Stable hash so duplicate pulls don't pretend to be different files
      const contentHash = createHash("sha256")
        .update(`${canonical}-${parseResult.rowCount}`)
        .digest("hex");

      const importBatch = await db.importBatch.create({
        data: {
          importType: source.importType,
          fileName,
          fileHash: contentHash,
          status: blocked ? "failed" : "processing",
          stagingStatus: blocked ? "cancelled" : "staged",
          rowCount: parseResult.rowCount,
          rowsErrored: parseResult.errors.length,
          uploadedById: userId ?? null,
          errorSummary: blocked
            ? gates.hardFails.map((g) => g.message).join(" | ")
            : null,
        },
      });

      // Log parse errors (skip rowNumber=0 sentinel rows for soft warnings)
      const realErrors = parseResult.errors.filter((e) => e.rowNumber > 0);
      if (realErrors.length > 0) {
        await db.importError.createMany({
          data: realErrors.map((e) => ({
            batchId: importBatch.id,
            rowNumber: e.rowNumber,
            fieldName: e.fieldName ?? null,
            errorType: e.errorType,
            errorMessage: e.message,
            rawValue: e.rawValue ?? null,
          })),
        });
      }

      let diff: DiffSummary | null = null;
      if (!blocked) {
        diff = await dispatcher.computeDiff(db, parseResult.payload);
        diff.warnings = [...diff.warnings, ...gates.softFails];

        // Surface row-0 "soft warnings from the parser" (e.g. header-only POs)
        // as diff warnings so they appear in the preview UI.
        const softParseWarnings = parseResult.errors
          .filter((e) => e.rowNumber === 0)
          .map((e) => ({ code: e.errorType, message: e.message }));
        if (softParseWarnings.length > 0) {
          diff.warnings = [...diff.warnings, ...softParseWarnings];
        }

        const envelope: StagedPayloadEnvelope = {
          version: 1,
          importType: source.importType,
          data: parseResult.payload,
        };
        await db.importBatch.update({
          where: { id: importBatch.id },
          data: {
            stagedPayload: envelope as unknown as object,
            diffSummary: diff as unknown as object,
          },
        });
      }

      // Create BlobSync audit record (keyed by canonical pathname so list
      // queries can find it regardless of how many files the source uses).
      const blobSync = await db.blobSync.create({
        data: {
          pathname: canonical,
          pulledAt: new Date(),
          rowCount: parseResult.rowCount,
          importedCount: 0,
          status: blocked ? "failed" : "preview",
          errorMessage: blocked ? gates.hardFails.map((g) => g.message).join(" | ") : null,
          importBatchId: importBatch.id,
        },
      });

      const formattedErrors = parseResult.errors.map((e) => ({
        row: e.rowNumber,
        field: e.fieldName ?? null,
        type: e.errorType,
        message: e.message,
        value: e.rawValue ?? null,
      }));

      const httpStatus = blocked ? 422 : 200;
      return Response.json(
        {
          mode: "staged",
          syncId: blobSync.id,
          batchId: importBatch.id,
          importType: source.importType,
          fileName,
          blocked,
          summary: {
            rowCount: parseResult.rowCount,
            willImport: parseResult.willImport,
            willSkip: parseResult.willSkip,
            errorCount: formattedErrors.length,
          },
          gates,
          diff,
          errors: formattedErrors,
        },
        { status: httpStatus },
      );
    }

    // ------------------------------------------------------------------ //
    // APPLY
    // ------------------------------------------------------------------ //
    if (action === "apply") {
      const syncId = body.syncId;
      const batchId = body.batchId;
      if (typeof syncId !== "string" || typeof batchId !== "string") {
        return Response.json({ error: "Missing syncId or batchId" }, { status: 400 });
      }

      const blobSync = await db.blobSync.findUnique({ where: { id: syncId } });
      if (!blobSync) {
        return Response.json({ error: "Sync record not found" }, { status: 404 });
      }
      if (blobSync.status !== "preview") {
        return Response.json(
          { error: `Sync is not in preview state (current: ${blobSync.status})` },
          { status: 400 },
        );
      }

      const result = await commitStaged(db, batchId);

      await db.blobSync.update({
        where: { id: syncId },
        data: {
          status: "applied",
          importedCount: result.rowsImported,
        },
      });

      return Response.json({ success: true, syncId, ...result });
    }

    // ------------------------------------------------------------------ //
    // CANCEL
    // ------------------------------------------------------------------ //
    if (action === "cancel") {
      const syncId = body.syncId;
      const batchId = body.batchId;
      if (typeof syncId !== "string" || typeof batchId !== "string") {
        return Response.json({ error: "Missing syncId or batchId" }, { status: 400 });
      }

      const blobSync = await db.blobSync.findUnique({ where: { id: syncId } });
      if (!blobSync) {
        return Response.json({ error: "Sync record not found" }, { status: 404 });
      }
      if (blobSync.status !== "preview") {
        return Response.json(
          { error: `Sync is not in preview state (current: ${blobSync.status})` },
          { status: 400 },
        );
      }

      await cancelStaged(db, batchId);

      await db.blobSync.update({
        where: { id: syncId },
        data: { status: "cancelled" },
      });

      return Response.json({ success: true, syncId });
    }

    return Response.json(
      { error: `Unknown action "${action}". Use: preview | apply | cancel` },
      { status: 400 },
    );
  } catch (err) {
    console.error("Blob sync failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Sync failed unexpectedly" },
      { status: 500 },
    );
  }
}
