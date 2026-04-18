"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge } from "@/components/ui";

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
}

export function TierManager({ runs, skus }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

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

  // SKUs where tier !== autoTier (manual overrides)
  const overrides = skus.filter((s) => s.autoTier && s.tier !== s.autoTier);

  return (
    <div className="space-y-6">
      {/* Actions */}
      <Card title="Tier Actions" subtitle="Calculate tiers from trailing 12-month revenue">
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
              className="px-5 py-2.5 bg-[var(--c-warning)] text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
            >
              Rollback
            </button>
          )}
        </div>

        {message && (
          <div
            className={`mt-4 px-4 py-3 rounded-lg text-sm font-medium ${
              message.type === "success"
                ? "bg-[var(--c-success-bg)] text-[var(--c-success-text)]"
                : "bg-[var(--c-error-bg)] text-[var(--c-error-text)]"
            }`}
          >
            {message.text}
          </div>
        )}
      </Card>

      {/* Snapshot history */}
      {runs.length > 0 && (
        <Card title="Tier Snapshot History" subtitle="Each calculation is preserved for audit and rollback">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="py-2 font-medium">Run Label</th>
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
                    {run.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="neutral">Saved</Badge>
                    )}
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
          subtitle={`${overrides.length} SKUs have manually set tiers that differ from the system calculation`}
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
                  <td className="py-2 text-center">
                    <Badge variant="neutral">Tier {sku.tier}</Badge>
                  </td>
                  <td className="py-2 text-center">
                    <Badge variant="warning">Tier {sku.autoTier}</Badge>
                  </td>
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
          Tiers are calculated from 12-month trailing revenue. A-tier SKUs (top 25% of revenue) get the highest
          inventory targets. Tiers are set annually — not recalculated every purchasing run. You can manually
          override any SKU&apos;s tier on its detail page.
        </p>
      </div>
    </div>
  );
}
