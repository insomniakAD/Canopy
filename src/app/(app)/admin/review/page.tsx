import { db } from "@/lib/db";
import { Card, Badge } from "@/components/ui";
import { ReviewInboxClient } from "./review-inbox-client";

function typeLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadStagedBatches() {
  try {
    const batches = await db.importBatch.findMany({
      where: { stagingStatus: "staged" },
      orderBy: { createdAt: "desc" },
      include: {
        uploadedBy: { select: { name: true, email: true } },
      },
    });
    return { ok: true as const, batches };
  } catch {
    return { ok: false as const, batches: [] };
  }
}

async function loadRecentHistory() {
  try {
    const batches = await db.importBatch.findMany({
      where: { stagingStatus: { in: ["committed", "cancelled"] } },
      orderBy: { completedAt: "desc" },
      take: 30,
      include: {
        uploadedBy: { select: { name: true, email: true } },
      },
    });
    return batches;
  } catch {
    return [];
  }
}

export default async function ReviewInboxPage() {
  const [staged, history] = await Promise.all([
    loadStagedBatches(),
    loadRecentHistory(),
  ]);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--c-text-primary)] mb-1">Review Inbox</h2>
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        Staged imports waiting to be committed or cancelled. Admins can action any user&apos;s staged upload.
      </p>

      {/* Staged queue */}
      <Card
        title="Staged — Awaiting Action"
        subtitle={staged.ok ? `${staged.batches.length} pending` : "Could not load"}
        className="mb-6"
      >
        {!staged.ok ? (
          <p className="text-sm text-[var(--c-text-tertiary)] py-4">Database not connected.</p>
        ) : staged.batches.length === 0 ? (
          <p className="text-sm text-[var(--c-text-tertiary)] py-4">No staged imports waiting. All clear.</p>
        ) : (
          <div className="space-y-3">
            {staged.batches.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-[var(--c-warning-border)] bg-[var(--c-warning-bg)] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--c-text-primary)] truncate">{b.fileName}</p>
                  <p className="text-xs text-[var(--c-text-secondary)] mt-0.5">
                    {typeLabel(b.importType)} · {fmtDate(b.createdAt)}
                    {b.uploadedBy && (
                      <span className="ml-2 text-[var(--c-text-tertiary)]">
                        by {b.uploadedBy.name ?? b.uploadedBy.email}
                      </span>
                    )}
                  </p>
                  {b.rowCount != null && (
                    <p className="text-xs text-[var(--c-text-tertiary)] mt-0.5">
                      {b.rowCount} rows parsed
                      {b.rowsErrored ? ` · ${b.rowsErrored} errors` : ""}
                    </p>
                  )}
                </div>
                <ReviewInboxClient batchId={b.id} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Recent history */}
      <Card
        title="Recent Activity"
        subtitle="Last 30 committed or cancelled staged imports"
      >
        {history.length === 0 ? (
          <p className="text-sm text-[var(--c-text-tertiary)] py-4">No activity yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">File</th>
                  <th className="px-6 py-3 font-medium">Uploader</th>
                  <th className="px-6 py-3 font-medium">Outcome</th>
                  <th className="px-6 py-3 font-medium text-right">Imported</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-page-bg)]">
                    <td className="px-6 py-3 text-[var(--c-text-secondary)] whitespace-nowrap">{fmtDate(b.completedAt)}</td>
                    <td className="px-6 py-3">{typeLabel(b.importType)}</td>
                    <td className="px-6 py-3 font-medium truncate max-w-[180px]">{b.fileName}</td>
                    <td className="px-6 py-3 text-[var(--c-text-secondary)]">
                      {b.uploadedBy?.name ?? b.uploadedBy?.email ?? "—"}
                    </td>
                    <td className="px-6 py-3">
                      <Badge variant={b.stagingStatus === "committed" ? "success" : "neutral"}>
                        {b.stagingStatus}
                      </Badge>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-[var(--c-success)]">
                      {b.rowsImported ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
