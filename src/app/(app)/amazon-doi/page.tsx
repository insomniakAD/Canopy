import { prisma } from "@/lib/db";
import { Card, Badge } from "@/components/ui";
import Link from "next/link";

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
  // Load current recommendations with Amazon DOI data
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
    orderBy: { amazonDoi: "asc" }, // Lowest DOI first (most urgent)
  });

  // Summary stats
  const totalSkus = recommendations.length;
  const criticalCount = recommendations.filter((r) => Number(r.amazonDoi) < (r.amazonTargetDoi ?? 40) * 0.3).length;
  const lowCount = recommendations.filter((r) => {
    const doi = Number(r.amazonDoi);
    const target = r.amazonTargetDoi ?? 40;
    return doi >= target * 0.3 && doi < target * 0.6;
  }).length;
  const healthyCount = recommendations.filter((r) => Number(r.amazonDoi) >= (r.amazonTargetDoi ?? 40) * 0.9).length;
  const avgDoi = totalSkus > 0
    ? Math.round(recommendations.reduce((s, r) => s + Number(r.amazonDoi ?? 0), 0) / totalSkus)
    : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Amazon Days of Inventory</h1>
        <p className="text-sm text-[var(--c-text-secondary)] mt-1">
          How many days of stock Amazon holds for each SKU. Low DOI = Amazon may issue a PO soon.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Amazon SKUs</p>
          <p className="text-2xl font-bold text-[var(--c-text-primary)] mt-1">{totalSkus}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Avg DOI</p>
          <p className="text-2xl font-bold text-[var(--c-text-primary)] mt-1">{avgDoi}d</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-error)] font-medium uppercase">Critical / Low</p>
          <p className="text-2xl font-bold text-[var(--c-error)] mt-1">{criticalCount + lowCount}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-success)] font-medium uppercase">Healthy</p>
          <p className="text-2xl font-bold text-[var(--c-success)] mt-1">{healthyCount}</p>
        </Card>
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
                </tr>
              </thead>
              <tbody>
                {recommendations.map((rec) => {
                  const doi = Number(rec.amazonDoi ?? 0);
                  const target = rec.amazonTargetDoi ?? 40;
                  return (
                    <tr key={rec.id} className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-row-hover)]">
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
                        <Badge variant="neutral">Tier {rec.sku.tier}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {rec.amazonOnHand?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {rec.amazonDailyVelocity != null ? Number(rec.amazonDailyVelocity).toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {doi.toFixed(0)}d
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--c-text-secondary)]">
                        {target}d
                      </td>
                      <td className="px-4 py-3 text-center">
                        <DoiBadge doi={doi} target={target} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {rec.woodinvilleExposure != null
                          ? `${Number(rec.woodinvilleExposure).toFixed(1)}/wk`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
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
