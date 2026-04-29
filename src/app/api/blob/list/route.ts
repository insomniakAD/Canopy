// ============================================================================
// API: GET /api/blob/list
// ============================================================================
// Returns the known blob sources (from the registry) enriched with:
//   - Live metadata from Golf's Vercel Blob (oldest upload across files, total size)
//   - Last sync record from the BlobSync table
//
// Used by /admin/sync to populate the source list.
// For multi-file sources, "lastUploadedAt" reflects the OLDEST file — both
// must be fresh for the join to be meaningful.

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { listBlobs } from "@/lib/blob/source";
import { BLOB_SOURCES, canonicalPathname } from "@/lib/blob/registry";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const allCanonicalPaths = BLOB_SOURCES.map(canonicalPathname);

    const [blobInfos, recentSyncs] = await Promise.all([
      listBlobs(),
      db.blobSync.findMany({
        where: { pathname: { in: allCanonicalPaths } },
        orderBy: { pulledAt: "desc" },
        take: BLOB_SOURCES.length * 5,
      }),
    ]);

    const blobByPathname = new Map(blobInfos.map((b) => [b.pathname, b]));
    const lastSyncByPathname = new Map<string, typeof recentSyncs[0]>();
    for (const sync of recentSyncs) {
      if (!lastSyncByPathname.has(sync.pathname)) {
        lastSyncByPathname.set(sync.pathname, sync);
      }
    }

    const sources = BLOB_SOURCES.map((source) => {
      const blobs = source.pathnames.map((p) => blobByPathname.get(p));
      const allAvailable = blobs.every((b): b is NonNullable<typeof b> => !!b);

      // Oldest upload = upper bound on data freshness (both must be fresh).
      const oldestUploadedAt = allAvailable
        ? blobs.reduce<Date | null>((oldest, b) => {
            const ts = b.uploadedAt;
            return oldest === null || ts < oldest ? ts : oldest;
          }, null)
        : null;
      const totalSize = allAvailable
        ? blobs.reduce((sum, b) => sum + b.size, 0)
        : null;

      const lastSync = lastSyncByPathname.get(canonicalPathname(source));

      return {
        key: source.key,
        pathnames: source.pathnames,
        // Display string for the file column ("a.json" or "a.json + b.json").
        pathnameLabel: source.pathnames.join(" + "),
        label: source.label,
        description: source.description,
        importType: source.importType,
        lastUploadedAt: oldestUploadedAt,
        sizeBytes: totalSize,
        available: allAvailable,
        lastSync: lastSync
          ? {
              syncId: lastSync.id,
              pulledAt: lastSync.pulledAt,
              status: lastSync.status,
              rowCount: lastSync.rowCount,
              importedCount: lastSync.importedCount,
              batchId: lastSync.importBatchId,
              errorMessage: lastSync.errorMessage,
            }
          : null,
      };
    });

    return Response.json({ sources });
  } catch (err) {
    console.error("Blob list failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to list blob sources" },
      { status: 500 },
    );
  }
}
