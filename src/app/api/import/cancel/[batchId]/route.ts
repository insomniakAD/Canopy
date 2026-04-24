// ============================================================================
// API: POST /api/import/cancel/[batchId]
// ============================================================================
// Cancels a previously staged import batch. Clears the staged payload and
// flips stagingStatus to "cancelled". No target writes occur.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { cancelStaged } from "@/lib/import/staging/orchestrator";
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

    const batch = await db.importBatch.findUnique({
      where: { id: batchId },
      select: { uploadedById: true },
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
        { error: "You don't have permission to cancel this batch" },
        { status: 403 }
      );
    }

    const result = await cancelStaged(db, batchId);
    return Response.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cancel failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
