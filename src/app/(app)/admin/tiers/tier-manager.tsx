"use client";

import { useState, useMemo } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, Badge } from "@/components/ui";
import type { ResultRow } from "./page";

interface TierRun {
  runLabel: string;
  calculatedAt: string;
  isActive: boolean;
  tierCounts: Record<string, number>;
  totalSkus: number;
}

interface SkuInfo {
  id: string;
  skuCode: string;
  name: string;
  tier: string;
  autoTier: string | null;
  averageSellingPrice: number | null;
}

interface Props {
  runs: TierRun[];
  skus: SkuInfo[];
  resultRows: ResultRow[];
  selectedMonths: number;
  latestRunLabel: string | null;
}

const TIER_FILTERS = ["All", "A", "B", "C", "LP"] as const;
const PERIOD_OPTIONS = [
  { label: "1 mo", value: 1 },
  { label: "3 mo", value: 3 },
  { label: "6 mo", value: 6 },
  { label: "12 mo", value: 12 },
] as const;

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function TierPill({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    A: "bg-[var(--c-success-bg)] text-[var(--c-success-text)]",
    B: "bg-[var(--c-accent-bg)] text-[var(--c-accent)]",
    C: "bg-[var(--c-surface)] text-[var(--c-text-secondary)]",
    LP: "bg-[var(--c-warning-bg)] text-[var(--c-warning-text)]",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${colors[tier] ?? colors.C}`}>
      {tier}
    </span>
  );
}

function TierChangePill({ prev, next }: { prev: string | null; next: string }) {
  if (!prev) return <TierPill tier={next} />;
  if (prev === next) return <TierPill tier={next} />;
  return (
    <span className="inline-flex items-center gap-1">
      <TierPill tier={prev} />
      <span className="text-[var(--c-text-tertiary)] text-xs">→</span>
      <TierPill tier={next} />
    </span>
  );
}

export function TierManager({ runs, skus, resultRows, selectedMonths, latestRunLabel }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [tierFilter, setTierFilter] = useState<string>("All");

  const activeRun = runs.find((r) => r.isActive);

  async function handleAction(action: string, runLabel?: string) {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/tiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, runLabel }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ text: data.message, type: "success" });
        router.refresh();
      } else {
        setMessage({ text: data.error ?? "Action failed", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  function setPeriod(months: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("months", String(months));
    router.push(`${pathname}?${params.toString()}`);
  }

  const filtered = useMemo(() => {
    if (tierFilter === "All") return resultRows;
    return resultRows.filter((r) => r.calculatedTier === tierFilter);
  }, [resultRows, tierFilter]);

  const overrides = skus.filter((s) => s.autoTier && s.tier !== s.autoTier);

  const hasChanged = resultRows.some(
    (r) => r.previousTier && r.previousTier !== r.calculatedTier
  );
  const changedCount = resultRows.filter(
    (r) => r.previousTier && r.previousTier !== r.calculatedTier
  ).length;

  return (
    <div className="space-y-6">
      {/* Actions */}
      <Card title="Tier Actions" subtitle="Calculate tiers from trailing 12-month revenue. Run once per year.">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleAction("calculate")}
            disabled={loading}
            className="px-5 py-2.5 bg-[var(--c-accent)] text-white text-sm font-medium rounded-lg hover:bg-[var(--c-accent-hover)] disabled:opacity-50 transition-colors"
          >
            {loading ? "Calculating…" : "Calculate Tiers"}
          </button>
          {runs.length > 0 && !runs[0].isActive && (
            <button
              onClick={() => handleAction("apply", runs[0].runLabel)}
              disabled={loading}
              className="px-5 py-2.5 bg-[var(--c-success)] text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
            >
              Apply &ldquo;{runs[0].runLabel}&rdquo;
            </button>
          )}
          {activeRun && (
            <button
              onClick={() => handleAction("rollback")}
              disabled={loading}
              className="px-5 py-2.5 border border-[var(--c-border)] text-[var(--c-text-secondary)] text-sm font-medium rounded-lg hover:bg-[var(--c-surface)] disabled:opacity-50 transition-colors"
            >
              Rollback
            </button>
          )}
        </div>

        {message && (
          <div className={`mt-4 px-4 py-3 rounded-lg text-sm font-medium ${
            message.type === "success"
              ? "bg-[var(--c-success-bg)] text-[var(--c-success-text)]"
              : "bg-[var(--c-error-bg)] text-[var(--c-error-text)]"
          }`}>
            {message.text}
          </div>
        )}
      </Card>

      {/* Results table */}
      {resultRows.length > 0 && (
        <Card
          title={`Tier Results — ${latestRunLabel}`}
          subtitle={hasChanged
            ? `${changedCount} SKU${changedCount !== 1 ? "s" : ""} changed tier vs. previous run`
            : "No tier changes vs. previous run"}
        >
          {/* Filter bar */}
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            {/* Tier filter */}
            <div className="flex items-center gap-1.5">
              {TIER_FILTERS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTierFilter(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    tierFilter === t
                      ? "bg-[var(--c-accent)] text-white"
                      : "bg-[var(--c-surface)] text-[var(--c-text-secondary)] hover:bg-[var(--c-border)]"
                  }`}
                >
                  {t === "All" ? `All (${resultRows.length})` : `${t} (${resultRows.filter((r) => r.calculatedTier === t).length})`}
                </button>
              ))}
            </div>

            {/* Period filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--c-text-tertiary)] mr-1">Revenue &amp; units over:</span>
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedMonths === opt.value
                      ? "bg-[var(--c-accent)] text-white"
                      : "bg-[var(--c-surface)] text-[var(--c-text-secondary)] hover:bg-[var(--c-border)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="px-6 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium text-center">Tier</th>
                  <th className="px-4 py-2 font-medium text-center">Previous Tier</th>
                  <th className="px-4 py-2 font-medium text-right">Revenue ({selectedMonths}mo)</th>
                  <th className="px-4 py-2 font-medium text-right">Units Sold ({selectedMonths}mo)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const changed = row.previousTier && row.previousTier !== row.calculatedTier;
                  return (
                    <tr
                      key={row.skuId}
                      className={`border-b border-[var(--c-border-row)] ${changed ? "bg-[var(--c-warning-bg)]/30" : "even:bg-[var(--c-surface)]"}`}
                    >
                      <td className="px-6 py-2.5">
                        <p className="font-semibold text-[var(--c-text-primary)]">{row.skuCode}</p>
                        <p className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[220px]">{row.skuName}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <TierPill tier={row.calculatedTier} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {row.previousTier
                          ? <TierChangePill prev={row.previousTier} next={row.calculatedTier} />
                          : <span className="text-xs text-[var(--c-text-tertiary)]">New</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-mono text-sm">
                        {row.revenue > 0 ? fmtUsd(row.revenue) : <span className="text-[var(--c-text-tertiary)]">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-mono text-sm">
                        {row.units > 0 ? row.units.toLocaleString() : <span className="text-[var(--c-text-tertiary)]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Snapshot history */}
      {runs.length > 0 && (
        <Card title="Tier Snapshot History" subtitle="Each calculation run is preserved for audit and rollback">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="py-2 font-medium">Run</th>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium text-center">A</th>
                <th className="py-2 font-medium text-center">B</th>
                <th className="py-2 font-medium text-center">C</th>
                <th className="py-2 font-medium text-center">LP</th>
                <th className="py-2 font-medium text-center">Total</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runLabel} className="border-b border-[var(--c-border-row)]">
                  <td className="py-3 font-semibold">{run.runLabel}</td>
                  <td className="py-3 text-[var(--c-text-secondary)]">
                    {new Date(run.calculatedAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 text-center font-mono">{run.tierCounts.A ?? 0}</td>
                  <td className="py-3 text-center font-mono">{run.tierCounts.B ?? 0}</td>
                  <td className="py-3 text-center font-mono">{run.tierCounts.C ?? 0}</td>
                  <td className="py-3 text-center font-mono">{run.tierCounts.LP ?? 0}</td>
                  <td className="py-3 text-center font-mono font-semibold">{run.totalSkus}</td>
                  <td className="py-3">
                    {run.isActive
                      ? <Badge variant="success">Active</Badge>
                      : <Badge variant="neutral">Saved</Badge>}
                  </td>
                  <td className="py-3">
                    {!run.isActive && (
                      <button
                        onClick={() => handleAction("apply", run.runLabel)}
                        disabled={loading}
                        className="text-xs text-[var(--c-accent)] hover:underline disabled:opacity-50"
                      >
                        Apply
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Manual overrides */}
      {overrides.length > 0 && (
        <Card
          title="Manual Tier Overrides"
          subtitle={`${overrides.length} SKU${overrides.length !== 1 ? "s" : ""} have manually set tiers that differ from the system calculation`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="py-2 font-medium">SKU</th>
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium text-center">Current Tier</th>
                <th className="py-2 font-medium text-center">Auto Tier</th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((sku) => (
                <tr key={sku.id} className="border-b border-[var(--c-border-row)]">
                  <td className="py-2 font-mono font-semibold">{sku.skuCode}</td>
                  <td className="py-2 text-[var(--c-text-secondary)]">{sku.name}</td>
                  <td className="py-2 text-center"><Badge variant="neutral">Tier {sku.tier}</Badge></td>
                  <td className="py-2 text-center"><Badge variant="warning">Tier {sku.autoTier}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Info box */}
      <div className="bg-[var(--c-page-bg)] border border-[var(--c-border)] rounded-xl px-6 py-4">
        <p className="text-sm text-[var(--c-text-secondary)]">
          <strong className="text-[var(--c-text-body)]">How tiers work:</strong>{" "}
          Tiers are calculated from 12-month trailing revenue. A-tier SKUs (top 25% of revenue) get
          the highest inventory targets. Tiers are set annually — not recalculated every purchasing run.
          All historical runs are stored for audit. The results table revenue and units columns reflect
          the selected period for context only — tier assignment always uses 12 months.
        </p>
      </div>
    </div>
  );
}
