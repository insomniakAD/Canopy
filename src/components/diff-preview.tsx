"use client";

import { Badge } from "@/components/ui";

// ---- Types (mirrors staging/types.ts but serialized for the client) ----

export interface GateCheck {
  code: string;
  message: string;
  count?: number;
  samples?: string[];
}

export interface PeriodTotal {
  period: string;
  previousTotal: number;
  newTotal: number;
  delta: number;
  deltaPct: number | null;
}

export interface RowDelta {
  skuCode: string;
  period?: string;
  previous: number | null;
  next: number;
  delta: number;
}

export interface DiffSummary {
  totalStagedRows: number;
  newRows: number;
  updatedRows: number;
  unchangedRows: number;
  periodTotals?: PeriodTotal[];
  topDeltas?: RowDelta[];
  warnings: GateCheck[];
}

export interface GateCheckResult {
  hardFails: GateCheck[];
  softFails: GateCheck[];
}

export interface StagedUploadResult {
  mode: "staged";
  batchId: string;
  importType: string;
  fileName: string;
  blocked: boolean;
  summary: {
    rowCount: number;
    willImport: number;
    willSkip: number;
    errorCount: number;
  };
  gates: GateCheckResult;
  diff: DiffSummary | null;
  errors: Array<{ row: number; field: string | null; type: string; message: string; value: string | null }>;
}

// ---- Helpers ----

function fmt(n: number): string {
  return n.toLocaleString();
}

function deltaPctLabel(pct: number | null): string {
  if (pct === null) return "new";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

function deltaPctColor(pct: number | null): string {
  if (pct === null) return "var(--c-info-text)";
  if (Math.abs(pct) >= 50) return "var(--c-warning-text)";
  return "var(--c-text-secondary)";
}

// ---- Sub-components ----

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-xl font-bold" style={{ color: color ?? "var(--c-text-primary)" }}>
        {fmt(value)}
      </p>
      <p className="text-xs text-[var(--c-text-secondary)] mt-0.5">{label}</p>
    </div>
  );
}

function GateList({ checks, variant }: { checks: GateCheck[]; variant: "error" | "warning" }) {
  if (checks.length === 0) return null;
  const bg = variant === "error" ? "var(--c-error-bg)" : "var(--c-warning-bg)";
  const border = variant === "error" ? "var(--c-error-border)" : "var(--c-warning-border)";
  const text = variant === "error" ? "var(--c-error-text)" : "var(--c-warning-text)";
  const icon = variant === "error" ? "✕" : "⚠";

  return (
    <div
      className="rounded-xl px-4 py-3 space-y-1.5"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      {checks.map((c, i) => (
        <div key={i} className="flex gap-2 text-sm">
          <span className="flex-shrink-0 font-bold" style={{ color: text }}>{icon}</span>
          <span style={{ color: text }}>{c.message}</span>
        </div>
      ))}
    </div>
  );
}

function PeriodTotalsTable({ rows }: { rows: PeriodTotal[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-[var(--c-text-secondary)] uppercase tracking-wide mb-2">
        By period
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--c-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)] text-xs text-[var(--c-text-secondary)] uppercase tracking-wide">
              <th className="px-4 py-2 text-left font-medium">Period</th>
              <th className="px-4 py-2 text-right font-medium">Before</th>
              <th className="px-4 py-2 text-right font-medium">After</th>
              <th className="px-4 py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--c-border-row)] last:border-0">
                <td className="px-4 py-2 font-medium text-[var(--c-text-primary)]">{r.period}</td>
                <td className="px-4 py-2 text-right font-mono text-[var(--c-text-secondary)]">
                  {r.previousTotal === 0 ? "—" : fmt(r.previousTotal)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-[var(--c-text-primary)]">
                  {fmt(r.newTotal)}
                </td>
                <td
                  className="px-4 py-2 text-right font-mono text-xs"
                  style={{ color: deltaPctColor(r.deltaPct) }}
                >
                  {deltaPctLabel(r.deltaPct)}
                  {r.deltaPct !== null && (
                    <span className="ml-1 text-[var(--c-text-tertiary)]">
                      ({r.delta >= 0 ? "+" : ""}{fmt(r.delta)})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopDeltasTable({ rows }: { rows: RowDelta[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-[var(--c-text-secondary)] uppercase tracking-wide mb-2">
        Largest changes
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--c-border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)] text-xs text-[var(--c-text-secondary)] uppercase tracking-wide">
              <th className="px-4 py-2 text-left font-medium">SKU</th>
              {rows.some((r) => r.period) && (
                <th className="px-4 py-2 text-left font-medium">Period</th>
              )}
              <th className="px-4 py-2 text-right font-medium">Before</th>
              <th className="px-4 py-2 text-right font-medium">After</th>
              <th className="px-4 py-2 text-right font-medium">Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[var(--c-border-row)] last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-[var(--c-text-primary)]">{r.skuCode}</td>
                {rows.some((row) => row.period) && (
                  <td className="px-4 py-2 text-xs text-[var(--c-text-secondary)]">{r.period ?? "—"}</td>
                )}
                <td className="px-4 py-2 text-right font-mono text-xs text-[var(--c-text-secondary)]">
                  {r.previous === null ? "new" : fmt(r.previous)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-[var(--c-text-primary)]">
                  {fmt(r.next)}
                </td>
                <td
                  className="px-4 py-2 text-right font-mono text-xs font-medium"
                  style={{ color: r.delta >= 0 ? "var(--c-success)" : "var(--c-error)" }}
                >
                  {r.delta >= 0 ? "+" : ""}{fmt(r.delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- CSV export ----

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  // Wrap in quotes if the value contains commas, quotes, or newlines
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildExportCsv(result: StagedUploadResult): string {
  const { gates, diff, errors } = result;
  const allWarnings = [...gates.softFails, ...(diff?.warnings ?? [])];

  const header = ["Type", "Row", "Field", "Code", "Message", "Raw Value"];
  const rows: string[][] = [];

  for (const g of gates.hardFails) {
    rows.push(["Block", "", "", g.code, g.message, ""]);
  }
  for (const w of allWarnings) {
    rows.push(["Warning", "", "", w.code, w.message, ""]);
  }
  for (const e of errors) {
    rows.push(["Error", String(e.row), e.field ?? "", e.type, e.message, e.value ?? ""]);
  }

  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return lines.join("\r\n");
}

function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Main component ----

interface DiffPreviewProps {
  result: StagedUploadResult;
  onCommit: () => void;
  onCancel: () => void;
  committing?: boolean;
  cancelling?: boolean;
}

export function DiffPreview({ result, onCommit, onCancel, committing, cancelling }: DiffPreviewProps) {
  const { summary, gates, diff, errors, blocked } = result;
  const hasSoftWarnings = gates.softFails.length > 0 || (diff?.warnings ?? []).length > 0;
  const allWarnings = [...gates.softFails, ...(diff?.warnings ?? [])];
  const hasLog = gates.hardFails.length > 0 || allWarnings.length > 0 || errors.length > 0;

  const handleExport = () => {
    const csv = buildExportCsv(result);
    const base = result.fileName.replace(/\.[^.]+$/, "");
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `import-log-${base}-${date}.csv`);
  };

  return (
    <div className="mt-4 border border-[var(--c-border)] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[var(--c-border)] bg-[var(--c-card-bg)] flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={blocked ? "error" : hasSoftWarnings ? "warning" : "neutral"}>
              {blocked ? "Blocked" : "Ready to review"}
            </Badge>
            <span className="text-sm text-[var(--c-text-secondary)] truncate">{result.fileName}</span>
          </div>
          <p className="text-xs text-[var(--c-text-tertiary)]">
            {summary.rowCount} rows parsed · {summary.willImport} to import · {summary.willSkip} skipped
            {summary.errorCount > 0 && ` · ${summary.errorCount} parse errors`}
          </p>
        </div>
        {hasLog && (
          <button
            onClick={handleExport}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--c-text-secondary)] border border-[var(--c-border)] rounded-lg hover:text-[var(--c-text-primary)] hover:border-[var(--c-text-tertiary)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Log
          </button>
        )}
      </div>

      <div className="px-5 py-4 space-y-5 bg-[var(--c-page-bg)]">
        {/* Hard fails */}
        {gates.hardFails.length > 0 && (
          <GateList checks={gates.hardFails} variant="error" />
        )}

        {/* Soft warnings */}
        {allWarnings.length > 0 && (
          <GateList checks={allWarnings} variant="warning" />
        )}

        {/* Diff counts */}
        {diff && (
          <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] px-5 py-4">
            <p className="text-xs font-medium text-[var(--c-text-secondary)] uppercase tracking-wide mb-4">
              What will change
            </p>
            <div className="grid grid-cols-3 gap-4">
              <StatBox label="New rows" value={diff.newRows} color="var(--c-success)" />
              <StatBox label="Updated" value={diff.updatedRows} color="var(--c-info-text)" />
              <StatBox label="Unchanged" value={diff.unchangedRows} color="var(--c-text-tertiary)" />
            </div>
          </div>
        )}

        {/* Period totals */}
        {diff?.periodTotals && diff.periodTotals.length > 0 && (
          <PeriodTotalsTable rows={diff.periodTotals} />
        )}

        {/* Top deltas */}
        {diff?.topDeltas && diff.topDeltas.length > 0 && (
          <TopDeltasTable rows={diff.topDeltas} />
        )}

        {/* Parse errors */}
        {errors.length > 0 && (
          <div>
            <p className="text-xs font-medium text-[var(--c-text-secondary)] uppercase tracking-wide mb-2">
              Parse errors ({errors.length})
            </p>
            <div className="max-h-40 overflow-y-auto space-y-1.5 rounded-lg border border-[var(--c-error-border)] p-3 bg-[var(--c-error-bg)]">
              {errors.slice(0, 20).map((err, i) => (
                <div key={i} className="text-xs">
                  <span className="font-medium text-[var(--c-error-text)]">Row {err.row}</span>
                  {err.field && <span className="text-[var(--c-error-text-mid)]"> · {err.field}</span>}
                  <span className="text-[var(--c-error-text-dark)]"> — {err.message}</span>
                </div>
              ))}
              {errors.length > 20 && (
                <p className="text-xs text-[var(--c-error-text-mid)]">…and {errors.length - 20} more</p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1 border-t border-[var(--c-border)]">
          <button
            onClick={onCommit}
            disabled={blocked || committing || cancelling}
            className="px-5 py-2.5 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {committing ? "Committing…" : "Commit Import"}
          </button>
          <button
            onClick={onCancel}
            disabled={committing || cancelling}
            className="px-4 py-2.5 text-sm font-medium text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)] border border-[var(--c-border)] rounded-lg hover:border-[var(--c-text-tertiary)] disabled:opacity-50 transition-colors"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
          {blocked && (
            <p className="text-xs text-[var(--c-error-text)] ml-1">
              Fix the errors above before committing.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
