"use client";

import { Card } from "@/components/ui";

interface TierRule {
  tier: string;
  targetDaysOfSupply: number;
  description: string | null;
}

interface SafetyRule {
  tier: string;
  safetyStockDays: number;
  description: string | null;
}

interface LeadTimeRule {
  country: string;
  poToProductionDays: number;
  productionDays: number;
  transitDays: number;
  portProcessingDays: number;
  totalLeadTimeDays: number;
}

interface ContainerRule {
  containerType: string;
  maxCbm: number;
  maxWeightKg: number;
  costEstimateUsd: number | null;
}

interface SeasonalityEntry {
  month: number;
  monthName: string;
  factor: number;
}

interface Props {
  tierRules: TierRule[];
  safetyRules: SafetyRule[];
  leadTimeRules: LeadTimeRule[];
  containerRules: ContainerRule[];
  seasonality: SeasonalityEntry[];
}

function containerLabel(t: string) {
  return t === "forty_hq" ? "40HQ" : t === "forty_gp" ? "40GP" : t;
}

export function SettingsEditor({ tierRules, safetyRules, leadTimeRules, containerRules, seasonality }: Props) {
  return (
    <div className="space-y-6">
      {/* Tier targeting rules */}
      <Card title="SKU Tier Rules" subtitle="How many days of supply to target for each tier">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
              <th className="py-2 font-medium">Tier</th>
              <th className="py-2 font-medium text-right">Target Days of Supply</th>
              <th className="py-2 font-medium text-right">Target Weeks</th>
              <th className="py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {tierRules.map((r) => (
              <tr key={r.tier} className="border-b border-[var(--c-border-row)]">
                <td className="py-3 font-semibold">Tier {r.tier}</td>
                <td className="py-3 text-right font-mono">{r.targetDaysOfSupply}</td>
                <td className="py-3 text-right font-mono text-[var(--c-text-secondary)]">{(r.targetDaysOfSupply / 7).toFixed(1)}</td>
                <td className="py-3 text-[var(--c-text-secondary)]">{r.description ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Safety stock rules */}
      <Card title="Safety Stock Rules" subtitle="Extra buffer stock days by tier to prevent stockouts">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
              <th className="py-2 font-medium">Tier</th>
              <th className="py-2 font-medium text-right">Safety Stock Days</th>
              <th className="py-2 font-medium text-right">Safety Weeks</th>
              <th className="py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {safetyRules.map((r) => (
              <tr key={r.tier} className="border-b border-[var(--c-border-row)]">
                <td className="py-3 font-semibold">Tier {r.tier}</td>
                <td className="py-3 text-right font-mono">{r.safetyStockDays}</td>
                <td className="py-3 text-right font-mono text-[var(--c-text-secondary)]">{(r.safetyStockDays / 7).toFixed(1)}</td>
                <td className="py-3 text-[var(--c-text-secondary)]">{r.description ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Lead time rules */}
      <Card title="Lead Time Rules" subtitle="Default lead time breakdown by source country (in days)">
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="px-6 py-2 font-medium">Country</th>
                <th className="px-4 py-2 font-medium text-right">PO to Production</th>
                <th className="px-4 py-2 font-medium text-right">Production</th>
                <th className="px-4 py-2 font-medium text-right">Transit</th>
                <th className="px-4 py-2 font-medium text-right">Port Processing</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {leadTimeRules.map((r) => (
                <tr key={r.country} className="border-b border-[var(--c-border-row)]">
                  <td className="px-6 py-3 font-semibold capitalize">{r.country}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.poToProductionDays}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.productionDays}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.transitDays}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.portProcessingDays}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{r.totalLeadTimeDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Container rules */}
      <Card title="Container Rules" subtitle="Capacity and cost estimates for each container type">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
              <th className="py-2 font-medium">Container</th>
              <th className="py-2 font-medium text-right">Max CBM</th>
              <th className="py-2 font-medium text-right">Max Weight (kg)</th>
              <th className="py-2 font-medium text-right">Est. Shipping Cost</th>
            </tr>
          </thead>
          <tbody>
            {containerRules.map((r) => (
              <tr key={r.containerType} className="border-b border-[var(--c-border-row)]">
                <td className="py-3 font-semibold">{containerLabel(r.containerType)}</td>
                <td className="py-3 text-right font-mono">{r.maxCbm}</td>
                <td className="py-3 text-right font-mono">{r.maxWeightKg.toLocaleString()}</td>
                <td className="py-3 text-right font-mono">
                  {r.costEstimateUsd != null ? `$${r.costEstimateUsd.toLocaleString()}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Seasonality factors */}
      <Card title="Seasonality Factors" subtitle="Monthly multipliers applied to demand velocity. 1.0 = no adjustment.">
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {seasonality.map((s) => (
            <div
              key={s.month}
              className={`rounded-lg border px-4 py-3 text-center ${
                s.factor !== 1
                  ? "border-[var(--c-accent)] bg-[var(--c-info-bg-light)]"
                  : "border-[var(--c-border)] bg-[var(--c-page-bg)]"
              }`}
            >
              <p className="text-xs text-[var(--c-text-secondary)] font-medium">{s.monthName}</p>
              <p className={`text-lg font-bold mt-0.5 ${
                s.factor > 1 ? "text-[var(--c-success)]" : s.factor < 1 ? "text-[var(--c-error)]" : "text-[var(--c-text-primary)]"
              }`}>
                {s.factor.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--c-text-tertiary)] mt-3">
          Factors above 1.0 increase the demand signal (e.g. holiday season). Below 1.0 reduces it.
          Update these values in the database to reflect seasonal demand patterns.
        </p>
      </Card>

      {/* Help note */}
      <div className="bg-[var(--c-page-bg)] border border-[var(--c-border)] rounded-xl px-6 py-4">
        <p className="text-sm text-[var(--c-text-secondary)]">
          <strong className="text-[var(--c-text-body)]">How to update settings:</strong> Configuration values are stored in the database.
          To change them, update the values directly in the database tables. Future versions of Canopy will include
          inline editing from this screen.
        </p>
      </div>
    </div>
  );
}
