"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface StagedBatch {
  id: string;
  importType: string;
  fileName: string;
  createdAt: Date;
}

function typeLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function StagedBannerClient({ batches }: { batches: StagedBatch[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); // batchId in flight

  async function commit(batchId: string) {
    setBusy(batchId);
    try {
      const res = await fetch(`/api/import/commit/${batchId}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? `Commit failed (${res.status})`);
      }
    } catch {
      alert("Network error during commit.");
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function cancel(batchId: string) {
    setBusy(batchId);
    try {
      await fetch(`/api/import/cancel/${batchId}`, { method: "POST" });
    } catch {
      // ignore
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <div className="mb-6 bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-5 py-4 space-y-3">
      <p className="text-sm font-medium text-[var(--c-warning-text)]">
        {batches.length === 1
          ? "You have 1 staged import waiting for review"
          : `You have ${batches.length} staged imports waiting for review`}
      </p>
      <p className="text-xs text-[var(--c-warning-text)] opacity-80">
        These files were analyzed but not yet committed. Commit to apply the data, or cancel to discard.
      </p>
      <div className="space-y-2">
        {batches.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between gap-4 bg-[var(--c-card-bg)] rounded-lg px-4 py-2.5 border border-[var(--c-warning-border)]"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--c-text-primary)] truncate">{b.fileName}</p>
              <p className="text-xs text-[var(--c-text-secondary)]">
                {typeLabel(b.importType)} · {fmtDate(b.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => commit(b.id)}
                disabled={busy === b.id}
                className="px-3 py-1.5 bg-[var(--c-accent)] text-white text-xs font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busy === b.id ? "…" : "Commit"}
              </button>
              <button
                onClick={() => cancel(b.id)}
                disabled={busy === b.id}
                className="px-3 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] border border-[var(--c-border)] rounded-lg hover:border-[var(--c-text-tertiary)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
