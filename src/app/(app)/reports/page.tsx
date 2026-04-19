import { db } from "@/lib/db";
import { Card, StatCard, Badge, TierBadge } from "@/components/ui";
import Link from "next/link";
import { StockoutExport, CountryExport } from "./report-export";

// Helpers -----------------------------------------------------------------

function fmtNum(v: number, d = 1) {
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtInt(v: number) {
  return v.toLocaleString();
}

function fmtPct(v: number) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtUsd(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Data loader -------------------------------------------------------------

async function loadReportData() {
  try {
    // Current recommendations
    const recs = await db.reorderRecommendation.findMany({
      where: { isCurrent: true },
      include: {
        sku: { select: { skuCode: true, name: true, tier: true, unitCostUsd: true } },
        recommendedFactory: { select: { name: true, country: true } },
      },
      orderBy: { weeksOfSupply: "asc" },
    });

    // Override log — last 20
    const overrides = await db.overrideLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        sku: { select: { skuCode: true, name: true } },
        user: { select: { name: true } },
      },
    });

    // SKU counts by tier
    const skus = await db.sku.findMany({
      where: { status: "active" },
      select: { tier: true },
    });
    const tierCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const s of skus) tierCounts[s.tier] = (tierCounts[s.tier] ?? 0) + 1;

    // Build report aggregates
    const orderRecs = recs.filter((r) => r.decision === "order");
    const watchRecs = recs.filter((r) => r.decision === "watch");

    // Inventory exposure — how much $ is tied up in order recs
    const totalOrderCost = orderRecs.reduce((s, r) => {
      const unitCost = r.sku.unitCostUsd ? Number(r.sku.unitCostUsd) : 0;
      return s + r.adjustedQuantity * unitCost;
    }, 0);

    // Forecast accuracy — recs that have Amazon comparison
    const withForecast = recs.filter((r) => r.amazonForecastWeekly != null);
    const avgVariance = withForecast.length > 0
      ? withForecast.reduce((s, r) => s + Math.abs(Number(r.forecastVariancePct ?? 0)), 0) / withForecast.length
      : null;

    // Stockout risks by tier
    const stockoutsByTier: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const r of orderRecs) {
      if (Number(r.weeksOfSupply) < 4) {
        stockoutsByTier[r.sku.tier] = (stockoutsByTier[r.sku.tier] ?? 0) + 1;
      }
    }

    // By country breakdown
    const byCountry = new Map<string, { skus: number; units: number; fractionHQ: number; cost: number }>();
    for (const r of orderRecs) {
      const country = r.recommendedFactory?.country ?? "unassigned";
      const entry = byCountry.get(country) ?? { skus: 0, units: 0, fractionHQ: 0, cost: 0 };
      entry.skus++;
      entry.units += r.adjustedQuantity;
      entry.fractionHQ += r.fclFractionHQ ? Number(r.fclFractionHQ) : 0;
      entry.cost += r.adjustedQuantity * (r.sku.unitCostUsd ? Number(r.sku.unitCostUsd) : 0);
      byCountry.set(country, entry);
    }

    return {
      ok: true as const,
      totalSkus: skus.length,
      tierCounts,
      orderCount: orderRecs.length,
      watchCount: watchRecs.length,
      totalOrderCost,
      avgVariance,
      forecastCount: withForecast.length,
      stockoutsByTier,
      byCountry: Array.from(byCountry.entries())
        .map(([country, d]) => ({ country, ...d }))
        .sort((a, b) => b.cost - a.cost),
      topStockoutRisks: orderRecs
        .filter((r) => Number(r.weeksOfSupply) < 6)
        .slice(0, 10)
        .map((r) => ({
          skuId: r.skuId,
          skuCode: r.sku.skuCode,
          skuName: r.sku.name,
          tier: r.sku.tier,
          wos: Number(r.weeksOfSupply),
          targetWos: Number(r.targetWeeksOfSupply),
          qty: r.adjustedQuantity,
          stockoutDate: r.projectedStockoutDate?.toISOString() ?? null,
        })),
      overrides,
      lastRun: recs[0]?.calculationDate ?? null,
    };
  } catch {
    return { ok: false as const };
  }
}

// Page --------------------------------------------------------------------

export default async function ReportsPage() {
  const data = await loadReportData();

  if (!data.ok) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Leadership Reports</h1>
        <div className="mt-6 bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-6 py-5">
          <p className="font-semibold text-[var(--c-warning-text)]">Database not connected</p>
        </div>
      </div>
    );
  }

  const {
    totalSkus, tierCounts, orderCount, watchCount,
    totalOrderCost, avgVariance, forecastCount,
    stockoutsByTier, byCountry, topStockoutRisks,
    overrides, lastRun,
  } = data;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--c-text-primary)] mb-1">Leadership Reports</h1>
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        High-level view of purchasing posture, risk exposure, and forecast accuracy.
        {lastRun && ` Data as of ${fmtDate(lastRun)}.`}
      </p>

      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard label="Active SKUs" value={totalSkus} />
        <StatCard label="SKUs to Order" value={orderCount} accent="blue" />
        <StatCard label="Watch List" value={watchCount} accent="amber" />
        <StatCard label="Order Exposure" value={fmtUsd(totalOrderCost)} accent="default" sub="product cost" />
        <StatCard
          label="Avg Forecast Variance"
          value={avgVariance != null ? `${avgVariance.toFixed(1)}%` : "—"}
          accent={avgVariance != null && avgVariance > 25 ? "amber" : "default"}
          sub={forecastCount > 0 ? `${forecastCount} SKUs with forecast` : "no forecasts"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Stockout risk by tier */}
        <Card title="Stockout Risk by Tier" subtitle="SKUs with less than 4 weeks of supply">
          <div className="space-y-3">
            {(["A", "B", "C"] as const).map((tier) => {
              const total = tierCounts[tier] ?? 0;
              const atRisk = stockoutsByTier[tier] ?? 0;
              const pct = total > 0 ? (atRisk / total) * 100 : 0;
              return (
                <div key={tier}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">Tier {tier} — {atRisk} of {total} at risk</span>
                    <span className={`font-semibold ${pct > 20 ? "text-[var(--c-error)]" : pct > 10 ? "text-[var(--c-warning)]" : "text-[var(--c-success)]"}`}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2.5 bg-[var(--c-border-row)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct > 20 ? "bg-[var(--c-error)]" : pct > 10 ? "bg-[var(--c-warning)]" : "bg-[var(--c-success)]"}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* By country */}
        <Card title="Orders by Country" subtitle="Purchasing exposure by sourcing country">
          {byCountry.length === 0 ? (
            <p className="text-sm text-[var(--c-text-tertiary)]">No orders to display.</p>
          ) : (
            <>
            <div className="flex justify-end mb-3">
              <CountryExport rows={byCountry} />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="py-2 font-medium">Country</th>
                  <th className="py-2 font-medium text-right">SKUs</th>
                  <th className="py-2 font-medium text-right">Units</th>
                  <th className="py-2 font-medium text-right">~40HQ</th>
                  <th className="py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byCountry.map((c) => (
                  <tr key={c.country} className="border-b border-[var(--c-border-row)]">
                    <td className="py-2 capitalize font-medium">{c.country}</td>
                    <td className="py-2 text-right font-mono">{c.skus}</td>
                    <td className="py-2 text-right font-mono">{fmtInt(c.units)}</td>
                    <td className="py-2 text-right font-mono">{fmtNum(c.fractionHQ)}</td>
                    <td className="py-2 text-right font-mono">{fmtUsd(c.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </Card>
      </div>

      {/* Top stockout risks */}
      {topStockoutRisks.length > 0 && (
        <Card
          title="Top Stockout Risks"
          subtitle="Order-recommended SKUs with the lowest weeks of supply"
          className="mb-6"
        >
          <div className="flex justify-end mb-3">
            <StockoutExport risks={topStockoutRisks} />
          </div>
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="px-6 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Tier</th>
                  <th className="px-4 py-2 font-medium text-right">Weeks of Supply</th>
                  <th className="px-4 py-2 font-medium text-right">Target</th>
                  <th className="px-4 py-2 font-medium text-right">Order Qty</th>
                  <th className="px-4 py-2 font-medium">Stockout Date</th>
                </tr>
              </thead>
              <tbody>
                {topStockoutRisks.map((r) => (
                  <tr key={r.skuId} className="border-b border-[var(--c-border-row)]">
                    <td className="px-6 py-2">
                      <Link href={`/skus/${r.skuId}`} className="text-[var(--c-accent)] font-medium hover:underline">
                        {r.skuCode}
                      </Link>
                      <p className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[180px]">{r.skuName}</p>
                    </td>
                    <td className="px-4 py-2"><TierBadge tier={r.tier} /></td>
                    <td className="px-4 py-2 text-right font-mono">
                      <span className={r.wos < 4 ? "text-[var(--c-error)] font-semibold" : ""}>
                        {fmtNum(r.wos)}w
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-[var(--c-text-tertiary)]">{fmtNum(r.targetWos)}w</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">{fmtInt(r.qty)}</td>
                    <td className="px-4 py-2 text-[var(--c-error)]">
                      {r.stockoutDate ? fmtDate(r.stockoutDate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Override log */}
      <Card
        title="Recent Overrides"
        subtitle="Manual adjustments made by buyers — tracks accountability"
      >
        {overrides.length === 0 ? (
          <p className="text-sm text-[var(--c-text-tertiary)]">No overrides recorded yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="px-6 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Original</th>
                  <th className="px-4 py-2 font-medium">Override</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id} className="border-b border-[var(--c-border-row)]">
                    <td className="px-6 py-2 text-[var(--c-text-secondary)] whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                    <td className="px-4 py-2">
                      <Link href={`/skus/${o.skuId}`} className="text-[var(--c-accent)] hover:underline">
                        {o.sku.skuCode}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{o.user.name}</td>
                    <td className="px-4 py-2 capitalize">{o.overrideType}</td>
                    <td className="px-4 py-2 font-mono">{o.originalValue}</td>
                    <td className="px-4 py-2 font-mono font-semibold">{o.overrideValue}</td>
                    <td className="px-4 py-2 text-[var(--c-text-secondary)] max-w-[200px] truncate">{o.reason}</td>
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
