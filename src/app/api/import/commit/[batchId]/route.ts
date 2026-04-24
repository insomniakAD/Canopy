// ============================================================================
// API: POST /api/import/commit/[batchId]
// ============================================================================
// Commits a previously staged import batch. Writes the staged payload to
// target tables and flips stagingStatus to "committed".
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { commitStaged } from "@/lib/import/staging/orchestrator";
import { auth } from "@/auth";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ batchId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { batchId } = await ctx.params;

    // Authorization: the uploader (any role) or an admin can commit a batch.
    const batch = await db.importBatch.findUnique({
      where: { id: batchId },
      select: { uploadedById: true, stagingStatus: true },
    });
    if (!batch) {
      return Response.json({ error: "Batch not found" }, { status: 404 });
    }

    const userId = (session.user as { id?: string }).id;
    const role = (session.user as { role?: string }).role;
    const isOwner = batch.uploadedById && userId === batch.uploadedById;
    const isAdmin = role === "admin";
    if (!isOwner && !isAdmin) {
      return Response.json(
        { error: "You don't have permission to commit this batch" },
        { status: 403 }
      );
    }

    const result = await commitStaged(db, batchId);
    return Response.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Commit failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
