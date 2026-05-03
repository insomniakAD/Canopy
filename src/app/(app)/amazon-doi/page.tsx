import { prisma } from "@/lib/db";
import { Card, Badge } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { AlertBanner } from "@/components/alert-banner";
import { DoiDistributionCard, DoiVarianceBars } from "./doi-charts";
import Link from "next/link";
import {
  calculateForecastDrops,
  loadDropAlertSettings,
} from "@/lib/engine/drop-alerts";

function DoiBadge({ doi, target }: { doi: number; target: number }) {
  if (doi <= 0) return <Badge variant="error">Out of Stock</Badge>;
  if (doi < target * 0.3) return <Badge variant="error">Critical</Badge>;
  if (doi < target * 0.6) return <Badge variant="warning">Low</Badge>;
  if (doi < target * 0.9) return <Badge variant="info">Below Target</Badge>;
  return <Badge variant="success">Healthy</Badge>;
}

function DiStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-[var(--c-text-tertiary)]">—</span>;
  const config: Record<string, { variant: "success" | "info" | "warning" | "error" | "neutral"; label: string }> = {
    green: { variant: "success", label: "Healthy" },
    blue: { variant: "info", label: "On Track" },
    amber: { variant: "warning", label: "Watch" },
    red: { variant: "error", label: "Alert" },
    critical: { variant: "error", label: "Critical" },
  };
  const c = config[status] ?? { variant: "neutral", label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

export default async function AmazonDoiPage() {
  const recommendations = await prisma.reorderRecommendation.findMany({
    where: {
      isCurrent: true,
      amazonDoi: { not: null },
    },
    include: {
      sku: {
        select: {
          skuCode: true,
          name: true,
          asin: true,
          tier: true,
          isDiEligible: true,
        },
      },
    },
    orderBy: { amazonDoi: "asc" },
  });

  const dropSettings = await loadDropAlertSettings(prisma);
  const forecastDrops = await calculateForecastDrops(prisma, new Date(), dropSettings);
  const dropBySku = new Map(forecastDrops.map((d) => [d.skuId, d]));

  // Bucket SKUs by DOI relative to target
  const points = recommendations.map((r) => ({
    skuCode: r.sku.skuCode,
    doi: Number(r.amazonDoi ?? 0),
    target: r.amazonTargetDoi ?? 40,
  }));

  const belowCount = points.filter((p) => p.doi < p.target * 0.9).length;
  const aboveCount = points.filter((p) => p.doi > p.target * 1.1).length;
  const onTargetCount = points.length - belowCount - aboveCount;

  // Forecast drop banner content
  const dropSkuCodes = forecastDrops
    .map((d) => recommendations.find((r) => r.skuId === d.skuId)?.sku.skuCode)
    .filter((c): c is string => Boolean(c))
    .slice(0, 2);
  const dropDescription = forecastDrops.length === 0
    ? null
    : `Amazon WoW forecast down ≥${dropSettings.forecastDropPct}% on ${dropSkuCodes.join(" and ")}${forecastDrops.length > dropSkuCodes.length ? ` and ${forecastDrops.length - dropSkuCodes.length} more` : ""}. Review reorder quantities.`;

  return (
    <div>
      <PageHeader title="Amazon DOI" />

      <p className="text-sm text-[var(--c-text-tertiary)] mb-5">
        How many days of stock Amazon holds per SKU. Low DOI = Amazon may issue a PO soon.
      </p>

      {dropDescription && (
        <div className="mb-6">
          <AlertBanner
            variant="warning"
            title="Forecast Drop Detected"
            description={dropDescription}
            href="#drops"
            cta={`View ${forecastDrops.length} ASIN${forecastDrops.length !== 1 ? "s" : ""}`}
          />
        </div>
      )}

      {/* Distribution + variance charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-1 h-full">
          <DoiDistributionCard
            belowCount={belowCount}
            onTargetCount={onTargetCount}
            aboveCount={aboveCount}
          />
        </div>
        <div className="lg:col-span-2 h-full">
          <DoiVarianceBars points={points} />
        </div>
      </div>

      {/* Main table */}
      <Card title="DOI by SKU" subtitle="Sorted by lowest DOI first — these SKUs may trigger Amazon POs soon">
        {recommendations.length === 0 ? (
          <p className="text-sm text-[var(--c-text-secondary)] py-8 text-center">
            No Amazon DOI data yet. Run the calculation engine after importing Amazon sales data.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="px-6 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">ASIN</th>
                  <th className="px-4 py-2 font-medium text-center">Tier</th>
                  <th className="px-4 py-2 font-medium text-right">Amazon On-Hand</th>
                  <th className="px-4 py-2 font-medium text-right">Daily Velocity</th>
                  <th className="px-4 py-2 font-medium text-right">DOI</th>
                  <th className="px-4 py-2 font-medium text-right">Target DOI</th>
                  <th className="px-4 py-2 font-medium text-center">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Woodinville Exp.</th>
                  <th className="px-4 py-2 font-medium text-right">DI Share</th>
                  <th className="px-4 py-2 font-medium text-center">DI Health</th>
                  <th
                    className="px-4 py-2 font-medium text-center"
                    title={`Flag when Amazon's next-${dropSettings.forecastWindowWeeks}w forecast falls ≥ ${dropSettings.forecastDropPct}% vs. the previous snapshot. Configurable in Settings.`}
                  >
                    Forecast {dropSettings.forecastWindowWeeks}w
                  </th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((rec) => {
                  const doi = Number(rec.amazonDoi ?? 0);
                  const target = rec.amazonTargetDoi ?? 40;
                  return (
                    <tr key={rec.id} className="border-b border-[var(--c-border-row)] even:bg-[var(--c-surface)] hover:bg-[var(--c-page-bg)]">
                      <td className="px-6 py-3">
                        <Link
                          href={`/skus/${rec.skuId}`}
                          className="font-semibold text-[var(--c-accent)] hover:underline"
                        >
                          {rec.sku.skuCode}
                        </Link>
                        <p className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[200px]">{rec.sku.name}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--c-text-secondary)]">
                        {rec.sku.asin ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="neutral">T-{rec.sku.tier}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {rec.amazonOnHand?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {rec.amazonDailyVelocity != null ? Number(rec.amazonDailyVelocity).toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold">
                        {doi.toFixed(0)}d
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--c-text-secondary)]">
                        {target}d
                      </td>
                      <td className="px-4 py-3 text-center">
                        <DoiBadge doi={doi} target={target} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {rec.woodinvilleExposure != null
                          ? `${Number(rec.woodinvilleExposure).toFixed(1)}/wk`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {rec.diSharePct != null && Number(rec.diSharePct) > 0
                          ? `${Number(rec.diSharePct).toFixed(0)}%`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {rec.sku.isDiEligible ? (
                          <DiStatusBadge status={rec.diHealthStatus} />
                        ) : (
                          <span className="text-xs text-[var(--c-text-tertiary)]">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {dropBySku.has(rec.skuId) ? (
                          <span
                            title={`Amazon forecast for the next ${dropSettings.forecastWindowWeeks}w fell from ${dropBySku.get(rec.skuId)!.previousWindowUnits} to ${dropBySku.get(rec.skuId)!.currentWindowUnits} units`}
                          >
                            <Badge variant="warning">
                              -{dropBySku.get(rec.skuId)!.dropPct.toFixed(0)}%
                            </Badge>
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--c-text-tertiary)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Context box */}
      <div className="mt-6 bg-[var(--c-page-bg)] border border-[var(--c-border)] rounded-xl px-6 py-4">
        <p className="text-sm text-[var(--c-text-secondary)]">
          <strong className="text-[var(--c-text-body)]">Remember:</strong>{" "}
          Winsome cannot push inventory to Amazon — Amazon issues POs. Low DOI is an awareness metric.
          When Amazon DOI drops, expect incoming 1P or DF orders. Ensure Woodinville has stock ready.
        </p>
      </div>
    </div>
  );
}
