"use client";

import { useState, useRef, useCallback } from "react";
import { DiffPreview, type StagedUploadResult } from "@/components/diff-preview";

type ImportTypeOption = {
  value: string;
  label: string;
  requires: readonly string[];
};

const DEFAULT_IMPORT_TYPES: readonly ImportTypeOption[] = [
  { value: "amazon_sales",          label: "Amazon Sales Diagnostic", requires: [] },
  { value: "amazon_vendor_central", label: "Amazon Vendor Central",   requires: [] },
  { value: "amazon_forecast",       label: "Amazon Forecasting",      requires: [] },
  { value: "di_orders",             label: "Amazon DI Orders",        requires: [] },
] as const;

function isTypeEnabled(t: ImportTypeOption, completedTypes: string[]): boolean {
  return t.requires.every((r) => completedTypes.includes(r));
}

// ---- State machine ----
// idle → uploading → preview → committing → done
//                           → cancelling → idle
type Phase = "idle" | "uploading" | "preview" | "committing" | "cancelling" | "done";

interface CommitResult {
  batchId: string;
  importType: string;
  rowsImported: number;
  rowsSkipped: number;
}

export function FileUploader({
  completedTypes = [],
  importTypes = DEFAULT_IMPORT_TYPES,
  onImportComplete,
}: {
  completedTypes?: string[];
  importTypes?: readonly ImportTypeOption[];
  onImportComplete?: () => void;
}) {
  const [importType, setImportType] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [staged, setStaged] = useState<StagedUploadResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const validateFile = (f: File): boolean => {
    if (f.size > MAX_FILE_SIZE) {
      setNetworkError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
      return false;
    }
    return true;
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && validateFile(dropped)) setFile(dropped);
  }, []);

  const handleUpload = async () => {
    if (!file || !importType) return;
    setPhase("uploading");
    setNetworkError(null);
    setStaged(null);
    setCommitResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("importType", importType);

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok && !json.batchId) {
        setNetworkError(json.error ?? `Upload failed (${res.status})`);
        setPhase("idle");
        return;
      }

      // All imports now return mode: "staged"
      setStaged(json as StagedUploadResult);
      setPhase("preview");
    } catch {
      setNetworkError("Network error — could not reach the server.");
      setPhase("idle");
    }
  };

  const handleCommit = async () => {
    if (!staged) return;
    setPhase("committing");

    try {
      const res = await fetch(`/api/import/commit/${staged.batchId}`, { method: "POST" });
      const json = await res.json();

      if (!res.ok) {
        setNetworkError(json.error ?? `Commit failed (${res.status})`);
        setPhase("preview");
        return;
      }

      setCommitResult(json as CommitResult);
      setPhase("done");
      onImportComplete?.();
    } catch {
      setNetworkError("Network error during commit.");
      setPhase("preview");
    }
  };

  const handleCancel = async () => {
    if (!staged) return;
    setPhase("cancelling");

    try {
      await fetch(`/api/import/cancel/${staged.batchId}`, { method: "POST" });
    } catch {
      // Ignore cancel errors — we reset regardless
    }

    reset();
  };

  const reset = () => {
    setFile(null);
    setStaged(null);
    setCommitResult(null);
    setNetworkError(null);
    setPhase("idle");
    if (fileRef.current) fileRef.current.value = "";
  };

  const isInFlight = phase === "uploading" || phase === "committing" || phase === "cancelling";

  return (
    <div>
      {/* Type selector + drop zone — hidden once we have a preview */}
      {phase !== "preview" && phase !== "committing" && phase !== "done" && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1.5">
              What type of file is this?
            </label>
            <select
              value={importType}
              onChange={(e) => setImportType(e.target.value)}
              disabled={isInFlight}
              className="w-full border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent disabled:opacity-50"
            >
              <option value="">Select import type…</option>
              {importTypes.map((t) => {
                const enabled = isTypeEnabled(t, completedTypes);
                return (
                  <option key={t.value} value={t.value} disabled={!enabled}>
                    {t.label}{!enabled ? " (requires earlier imports)" : ""}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !isInFlight && fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              isInFlight
                ? "border-[var(--c-border)] bg-[var(--c-page-bg)] cursor-default opacity-50"
                : dragging
                ? "border-[var(--c-accent)] bg-[var(--c-info-bg-light)] cursor-pointer"
                : file
                ? "border-[var(--c-success)] bg-[var(--c-success-bg-light)] cursor-pointer"
                : "border-[var(--c-border)] hover:border-[var(--c-text-tertiary)] bg-[var(--c-page-bg)] cursor-pointer"
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
              onChange={(e) => { const f = e.target.files?.[0]; if (f && validateFile(f)) setFile(f); }}
              className="hidden"
            />
            {file ? (
              <div>
                <p className="text-sm font-medium text-[var(--c-success-text)]">{file.name}</p>
                <p className="text-xs text-[var(--c-text-secondary)] mt-1">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
            ) : (
              <div>
                <svg className="w-8 h-8 mx-auto text-[var(--c-text-tertiary)] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm text-[var(--c-text-secondary)]">
                  Drag and drop a file here, or <span className="text-[var(--c-accent)] font-medium">click to browse</span>
                </p>
                <p className="text-xs text-[var(--c-text-tertiary)] mt-1">Accepts .xlsx, .xls, .csv, or .txt (max 10 MB)</p>
              </div>
            )}
          </div>

          {/* Upload button */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={handleUpload}
              disabled={!file || !importType || isInFlight}
              className="px-5 py-2.5 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {phase === "uploading" ? "Analyzing…" : "Preview Import"}
            </button>
            {file && !isInFlight && (
              <button onClick={reset} className="text-sm text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]">
                Clear
              </button>
            )}
          </div>
        </>
      )}

      {/* Network error */}
      {networkError && (
        <div className="mt-4 bg-[var(--c-error-bg)] border border-[var(--c-error-border)] rounded-xl px-5 py-4">
          <p className="text-sm text-[var(--c-error-text)] font-medium">{networkError}</p>
        </div>
      )}

      {/* Diff preview */}
      {staged && (phase === "preview" || phase === "committing" || phase === "cancelling") && (
        <DiffPreview
          result={staged}
          onCommit={handleCommit}
          onCancel={handleCancel}
          committing={phase === "committing"}
          cancelling={phase === "cancelling"}
        />
      )}

      {/* Commit success */}
      {phase === "done" && commitResult && (
        <div className="mt-4 bg-[var(--c-card-bg)] border border-[var(--c-border)] rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--c-success)] flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span className="text-sm font-medium text-[var(--c-text-primary)]">Import committed</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-center mb-4">
            <div>
              <p className="text-xl font-bold text-[var(--c-success)]">{commitResult.rowsImported.toLocaleString()}</p>
              <p className="text-xs text-[var(--c-text-secondary)] mt-0.5">Rows imported</p>
            </div>
            <div>
              <p className="text-xl font-bold text-[var(--c-warning)]">{commitResult.rowsSkipped.toLocaleString()}</p>
              <p className="text-xs text-[var(--c-text-secondary)] mt-0.5">Rows skipped</p>
            </div>
          </div>
          <button
            onClick={reset}
            className="text-sm text-[var(--c-accent)] hover:underline"
          >
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
