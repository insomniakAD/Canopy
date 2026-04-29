"use client";

import { useState, useCallback, useEffect } from "react";
import { Card } from "@/components/ui";
import { DiffPreview, type StagedUploadResult } from "@/components/diff-preview";

// ---- Types mirroring /api/blob/list response ----

interface LastSync {
  syncId: string;
  pulledAt: string;
  status: "preview" | "applied" | "cancelled" | "failed";
  rowCount: number;
  importedCount: number;
  batchId: string | null;
  errorMessage: string | null;
}

interface BlobSource {
  key: string;
  pathnames: string[];
  pathnameLabel: string;
  label: string;
  description: string;
  importType: string;
  lastUploadedAt: string | null;
  sizeBytes: number | null;
  available: boolean;
  lastSync: LastSync | null;
}

// The preview response extends StagedUploadResult with syncId
interface PreviewResult extends StagedUploadResult {
  syncId: string;
}

// ---- Helpers ----

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function SyncStatusBadge({ status }: { status: LastSync["status"] }) {
  const styles: Record<LastSync["status"], string> = {
    applied:   "bg-[var(--c-success-bg)] text-[var(--c-success-text)]",
    preview:   "bg-[var(--c-info-bg)] text-[var(--c-info-text)]",
    cancelled: "bg-[var(--c-neutral-bg,#f3f4f6)] text-[var(--c-text-secondary)]",
    failed:    "bg-[var(--c-error-bg)] text-[var(--c-error-text)]",
  };
  const labels: Record<LastSync["status"], string> = {
    applied: "Applied", preview: "Pending", cancelled: "Cancelled", failed: "Failed",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ---- Main component ----

export function SyncClient() {
  const [sources, setSources] = useState<BlobSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Per-source pull state
  const [pulling, setPulling] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  // Apply / cancel state
  const [committing, setCommitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadSources = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await fetch("/api/blob/list");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { sources: BlobSource[] };
      setSources(data.sources);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSources(); }, [loadSources]);

  const handlePull = useCallback(async (key: string) => {
    setPulling((p) => ({ ...p, [key]: true }));
    setPreview(null);
    setPreviewKey(null);
    try {
      const res = await fetch("/api/blob/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", key }),
      });
      const json = await res.json() as PreviewResult & { error?: string };
      if (!res.ok && !json.mode) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setPreview(json as PreviewResult);
      setPreviewKey(key);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Pull failed");
    } finally {
      setPulling((p) => ({ ...p, [key]: false }));
    }
  }, []);

  const handleCommit = useCallback(async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      const res = await fetch("/api/blob/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          syncId: preview.syncId,
          batchId: preview.batchId,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPreview(null);
      setPreviewKey(null);
      await loadSources();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setCommitting(false);
    }
  }, [preview, loadSources]);

  const handleCancel = useCallback(async () => {
    if (!preview) return;
    setCancelling(true);
    try {
      await fetch("/api/blob/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          syncId: preview.syncId,
          batchId: preview.batchId,
        }),
      });
    } finally {
      setPreview(null);
      setPreviewKey(null);
      setCancelling(false);
    }
  }, [preview]);

  // ---- Render ----

  if (loading) {
    return (
      <Card title="Live Sync" subtitle="Pull fresh WDS data from Golf's Vercel Blob storage.">
        <p className="text-sm text-[var(--c-text-secondary)] py-4">Loading sources…</p>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card title="Live Sync">
        <p className="text-sm text-[var(--c-error)]">{loadError}</p>
        <button
          onClick={loadSources}
          className="mt-3 text-sm text-[var(--c-accent)] hover:underline"
        >
          Retry
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card
        title="Live Sync"
        subtitle="Pull fresh WDS data from Golf's Vercel Blob storage. New files overwrite the previous pull after you review the diff."
      >
        <div className="overflow-x-auto -mx-6 -mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-left text-xs text-[var(--c-text-secondary)] uppercase tracking-wide">
                <th className="px-6 py-3 font-medium">Source</th>
                <th className="px-6 py-3 font-medium">File</th>
                <th className="px-6 py-3 font-medium">Last Updated by Golf</th>
                <th className="px-6 py-3 font-medium">Size</th>
                <th className="px-6 py-3 font-medium">Last Pull</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--c-border)]">
              {sources.map((source) => {
                const isPulling = pulling[source.key] ?? false;
                const isThisPreviewed = previewKey === source.key && preview !== null;

                return (
                  <tr
                    key={source.key}
                    className={`transition-colors ${isThisPreviewed ? "bg-[var(--c-info-bg-subtle,var(--c-page-bg))]" : "hover:bg-[var(--c-page-bg)]"}`}
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium text-[var(--c-text-primary)]">{source.label}</div>
                      <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">{source.description}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-[var(--c-text-secondary)]">
                      {source.pathnameLabel}
                    </td>
                    <td className="px-6 py-4 text-[var(--c-text-secondary)]">
                      {formatDate(source.lastUploadedAt)}
                    </td>
                    <td className="px-6 py-4 text-[var(--c-text-secondary)]">
                      {formatBytes(source.sizeBytes)}
                    </td>
                    <td className="px-6 py-4 text-[var(--c-text-secondary)]">
                      {source.lastSync ? formatDate(source.lastSync.pulledAt) : "Never"}
                      {source.lastSync?.status === "applied" && (
                        <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">
                          {source.lastSync.importedCount.toLocaleString()} rows written
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {source.lastSync ? (
                        <SyncStatusBadge status={source.lastSync.status} />
                      ) : (
                        <span className="text-xs text-[var(--c-text-tertiary)]">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!source.available ? (
                        <span className="text-xs text-[var(--c-text-tertiary)]">Not available</span>
                      ) : (
                        <button
                          onClick={() => handlePull(source.key)}
                          disabled={isPulling || committing}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg
                            bg-[var(--c-accent)] text-white
                            hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                        >
                          {isPulling ? (
                            <>
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                              Pulling…
                            </>
                          ) : (
                            <>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Pull
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Diff preview appears below the table when a pull completes */}
      {preview && (
        <DiffPreview
          result={preview}
          onCommit={handleCommit}
          onCancel={handleCancel}
          committing={committing}
          cancelling={cancelling}
        />
      )}

      <Card title="About Live Sync" className="text-sm">
        <div className="space-y-3 text-[var(--c-text-secondary)]">
          <p>
            Golf refreshes these files daily from WDS. Canopy pulls on demand — you review the
            diff before anything is written to the database.
          </p>
          <p>
            <span className="font-medium text-[var(--c-text-primary)]">WDS Monthly Sales — Cartons</span>
            {" "}replaces the manual "WDS Monthly Sales (Cartons)" upload on the Import Data page.
            The Import Data page continues to handle revenue, inventory, active items, and all Amazon data
            until Golf adds those files here.
          </p>
          <p className="text-[var(--c-text-tertiary)] text-xs">
            Files are private — only Canopy (using Golf's token) can access them. The token is
            stored server-side only and never sent to the browser.
          </p>
        </div>
      </Card>
    </div>
  );
}
