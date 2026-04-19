import { db } from "@/lib/db";
import { Card, StatCard } from "@/components/ui";
import { SkuTable } from "./sku-table";
import { RunEngineButton } from "@/components/run-engine-button";

async function loadRecommendations() {
  try {
    const recs = await db.reorderRecommendation.findMany({
      where: { isCurrent: true },
      orderBy: [{ decision: "asc" }, { weeksOfSupply: "asc" }],
      include: {
        sku: { select: { skuCode: true, name: true, tier: true, asin: true } },
        recommendedFactory: { select: { name: true, country: true } },
      },
    });

    const orderRecs = recs.filter((r) => r.decision === "order");
    const watchRecs = recs.filter((r) => r.decision === "watch");
    const dnoRecs = recs.filter((r) => r.decision === "do_not_order");

    const totalUnits = orderRecs.reduce((s, r) => s + r.adjustedQuantity, 0);
    const totalFractionHQ = orderRecs.reduce(
      (s, r) => s + (r.fclFractionHQ ? Number(r.fclFractionHQ) : 0),
      0
    );

    const mapped = recs.map((r) => ({
      id: r.id,
      skuId: r.skuId,
      skuCode: r.sku.skuCode,
      skuName: r.sku.name,
      tier: r.sku.tier,
      asin: r.sku.asin,
      decision: r.decision,
      weeklyDemand: Number(r.weeklyDemand),
      onHandInventory: r.onHandInventory,
      inboundInventory: r.inboundInventory,
      weeksOfSupply: Number(r.weeksOfSupply),
      targetWeeksOfSupply: Number(r.targetWeeksOfSupply),
      reorderQuantity: r.reorderQuantity,
      adjustedQuantity: r.adjustedQuantity,
      amazonForecastWeekly: r.amazonForecastWeekly ? Number(r.amazonForecastWeekly) : null,
      forecastVariancePct: r.forecastVariancePct ? Number(r.forecastVariancePct) : null,
      factory: r.recommendedFactory?.name ?? null,
      orderByDate: r.recommendedOrderByDate?.toISOString() ?? null,
      projectedStockoutDate: r.projectedStockoutDate?.toISOString() ?? null,
    }));

    return {
      ok: true as const,
      recs: mapped,
      orderCount: orderRecs.length,
      watchCount: watchRecs.length,
      dnoCount: dnoRecs.length,
      totalUnits,
      totalFractionHQ,
      lastRun: recs[0]?.calculationDate ?? null,
    };
  } catch {
    return { ok: false as const };
  }
}

export default async function SkuPlanningPage() {
  const data = await loadRecommendations();

  if (!data.ok) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)] mb-1">SKU Planning</h1>
        <div className="mt-6 bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-6 py-5">
          <p className="font-semibold text-[var(--c-warning-text)]">Database not connected</p>
          <p className="text-sm text-[var(--c-warning-text-alt)] mt-1">
            Set up the database to view SKU planning recommendations.
          </p>
        </div>
      </div>
    );
  }

  const { recs, orderCount, watchCount, dnoCount, totalUnits, totalFractionHQ, lastRun } = data;
  const hasRecs = recs.length > 0;

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">SKU Planning</h1>
          <p className="text-sm text-[var(--c-text-secondary)] mt-1">
            {lastRun
              ? `Recommendations as of ${new Date(lastRun).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : "No recommendations generated yet"}
          </p>
        </div>
        <RunEngineButton />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Order" value={orderCount} accent="blue" />
        <StatCard label="Watch" value={watchCount} accent="amber" />
        <StatCard label="Do Not Order" value={dnoCount} accent="default" />
        <StatCard label="Total Units" value={totalUnits.toLocaleString()} accent="blue" />
        <StatCard label="~40HQ Containers" value={totalFractionHQ.toFixed(1)} accent="default" />
      </div>

      {hasRecs ? (
        <SkuTable recommendations={recs} />
      ) : (
        <Card title="No Recommendations Yet">
          <p className="text-sm text-[var(--c-text-secondary)]">
            Import your data files first, then run the recommendation engine to see ordering decisions here.
          </p>
        </Card>
      )}
    </div>
  );
}
