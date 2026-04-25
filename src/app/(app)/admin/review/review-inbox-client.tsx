"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReviewInboxClient({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"commit" | "cancel" | null>(null);

  async function commit() {
    setBusy("commit");
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

  async function cancel() {
    setBusy("cancel");
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
    <div className="flex items-center gap-2 flex-shrink-0">
      <button
        onClick={commit}
        disabled={busy !== null}
        className="px-3 py-1.5 bg-[var(--c-accent)] text-white text-xs font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy === "commit" ? "Committing…" : "Commit"}
      </button>
      <button
        onClick={cancel}
        disabled={busy !== null}
        className="px-3 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] border border-[var(--c-border)] rounded-lg hover:border-[var(--c-text-tertiary)] disabled:opacity-50 transition-colors"
      >
        {busy === "cancel" ? "Cancelling…" : "Cancel"}
      </button>
    </div>
  );
}
