"use client";

import { useState, useRef, useCallback } from "react";
import { Badge } from "@/components/ui";

const IMPORT_TYPES = [
  { value: "wds_inventory", label: "WDS Inventory", requires: [] as string[] },
  { value: "asin_mapping", label: "ASIN Mapping", requires: ["wds_inventory"] },
  { value: "wds_monthly_sales", label: "WDS Monthly Sales", requires: ["wds_inventory"] },
  { value: "amazon_sales", label: "Amazon Sales Diagnostic", requires: ["wds_inventory", "asin_mapping"] },
  { value: "amazon_vendor_central", label: "Amazon Vendor Central", requires: ["wds_inventory", "asin_mapping"] },
  { value: "amazon_forecast", label: "Amazon Forecasting", requires: ["wds_inventory", "asin_mapping"] },
  { value: "purchase_orders", label: "Purchase Orders", requires: ["wds_inventory"] },
] as const;

interface ImportResult {
  success: boolean;
  summary: {
    batchId: string;
    importType: string;
    fileName: string;
    rowCount: number;
    rowsImported: number;
    rowsSkipped: number;
    rowsErrored: number;
  };
  errors: Array<{
    row: number;
    field: string | null;
    type: string;
    message: string;
    value: string | null;
  }>;
}

function isTypeEnabled(
  importType: (typeof IMPORT_TYPES)[number],
  completedTypes: string[],
): boolean {
  return importType.requires.every((req) => completedTypes.includes(req));
}

export function FileUploader({
  completedTypes = [],
  onImportComplete,
}: {
  completedTypes?: string[];
  onImportComplete?: () => void;
}) {
  const [importType, setImportType] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

  const validateFile = (f: File): boolean => {
    if (f.size > MAX_FILE_SIZE) {
      setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 10 MB.`);
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

  const handleSubmit = async () => {
    if (!file || !importType) return;
    setUploading(true);
    setResult(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("importType", importType);

      const res = await fetch("/api/import", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok && !json.summary) {
        setError(json.error ?? `Import failed (${res.status})`);
      } else {
        setResult(json as ImportResult);
        onImportComplete?.();
      }
    } catch {
      setError("Network error — could not reach the server.");
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      {/* Import type selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-[var(--c-text-primary)] mb-1.5">
          What type of file is this?
        </label>
        <select
          value={importType}
          onChange={(e) => setImportType(e.target.value)}
          className="w-full border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
        >
          <option value="">Select import type…</option>
          {IMPORT_TYPES.map((t) => {
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
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-[var(--c-accent)] bg-[var(--c-info-bg-light)]"
            : file
            ? "border-[var(--c-success)] bg-[var(--c-success-bg-light)]"
            : "border-[var(--c-border)] hover:border-[var(--c-text-tertiary)] bg-[var(--c-page-bg)]"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
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
            <p className="text-xs text-[var(--c-text-tertiary)] mt-1">Accepts .xlsx, .xls, or .csv (max 10 MB)</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={handleSubmit}
          disabled={!file || !importType || uploading}
          className="px-5 py-2.5 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {uploading ? "Importing…" : "Import File"}
        </button>
        {file && (
          <button onClick={reset} className="text-sm text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]">
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 bg-[var(--c-error-bg)] border border-[var(--c-error-border)] rounded-xl px-5 py-4">
          <p className="text-sm text-[var(--c-error-text)] font-medium">{error}</p>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-4 bg-[var(--c-card-bg)] border border-[var(--c-border)] rounded-xl px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Badge variant={result.summary.rowsErrored === 0 ? "success" : "warning"}>
              {result.summary.rowsErrored === 0 ? "Success" : "Partial Import"}
            </Badge>
            <span className="text-sm text-[var(--c-text-secondary)]">{result.summary.fileName}</span>
          </div>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-[var(--c-text-primary)]">{result.summary.rowCount}</p>
              <p className="text-xs text-[var(--c-text-secondary)]">Total Rows</p>
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--c-success)]">{result.summary.rowsImported}</p>
              <p className="text-xs text-[var(--c-text-secondary)]">Imported</p>
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--c-warning)]">{result.summary.rowsSkipped}</p>
              <p className="text-xs text-[var(--c-text-secondary)]">Skipped</p>
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--c-error)]">{result.summary.rowsErrored}</p>
              <p className="text-xs text-[var(--c-text-secondary)]">Errors</p>
            </div>
          </div>

          {/* Error details */}
          {result.errors.length > 0 && (
            <div className="mt-4 border-t border-[var(--c-border)] pt-3">
              <p className="text-xs font-medium text-[var(--c-text-secondary)] mb-2">
                Errors ({result.errors.length})
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {result.errors.slice(0, 20).map((err, i) => (
                  <div key={i} className="text-xs bg-[var(--c-error-bg-light)] rounded px-3 py-1.5">
                    <span className="font-medium text-[var(--c-error-text)]">Row {err.row}</span>
                    {err.field && <span className="text-[var(--c-error-text-mid)]"> &middot; {err.field}</span>}
                    <span className="text-[var(--c-error-text-dark)]"> — {err.message}</span>
                  </div>
                ))}
                {result.errors.length > 20 && (
                  <p className="text-xs text-[var(--c-text-tertiary)]">
                    …and {result.errors.length - 20} more errors
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
