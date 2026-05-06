import { Suspense } from "react";
import { type SalesChannel, type SkuTier } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { Card, StatCard, TierBadge } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { StockoutExport } from "./report-export";
import { ChannelMixChart, ChannelTrendChart, type ChannelMonthly } from "./leadership-charts";
import { TierRevenueMixCard, FactoryConcentrationCard } from "./leadership-mix";
import { FilterPillsBar } from "./filter-pills";

// Helpers -----------------------------------------------------------------

function fmtNum(v: number, d = 1) {
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtInt(v: number) {
  return v.toLocaleString();
}

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtUsd(v: number, compact = true) {
  if (compact) {
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  }
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function monthLabel(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

// Data loader -------------------------------------------------------------

async function loadForecastSummary(now: Date) {
  try {
    const pastForecasts = await db.amazonForecast.findMany({
      where: { weekEndDate: { lt: now } },
      select: { skuId: true, forecastUnits: true },
    });
    if (pastForecasts.length === 0) return null;

    const skuIds = [...new Set(pastForecasts.map((f) => f.skuId))];
    const salesAgg = await db.salesRecord.findMany({
      where: {
        skuId: { in: skuIds },
        channel: { in: ["amazon_1p", "amazon_di"] },
      },
      select: { skuId: true, quantity: true },
    });
    const actualBySku = new Map<string, number>();
    for (const s of salesAgg) {
      actualBySku.set(s.skuId, (actualBySku.get(s.skuId) ?? 0) + s.quantity);
    }
    const forecastBySku = new Map<string, number>();
    for (const f of pastForecasts) {
      forecastBySku.set(f.skuId, (forecastBySku.get(f.skuId) ?? 0) + Number(f.forecastUnits));
    }

    let totalForecast = 0;
    let totalActual = 0;
    for (const [skuId, forecast] of forecastBySku) {
      totalForecast += forecast;
      totalActual += actualBySku.get(skuId) ?? 0;
    }
    const overallAccuracy = totalForecast > 0 ? Math.round((totalActual / totalForecast) * 100) : 0;

    return { skuCount: skuIds.length, overallAccuracy };
  } catch {
    return null;
  }
}

async function loadLeadershipData(filters: {
  channel: string;
  tier: string;
  period: string;
}) {
  try {
    const now = new Date();

    // Derive date window from period (year)
    const year = parseInt(filters.period, 10);
    const isCurrentYear = year === now.getFullYear();
    const startDate = new Date(year, 0, 1);
    const endDate = isCurrentYear ? now : new Date(year, 11, 31, 23, 59, 59);

    // Prior-year comparison window
    const priorStart = new Date(year - 1, 0, 1);
    const priorEnd = isCurrentYear
      ? new Date(year - 1, now.getMonth(), now.getDate())
      : new Date(year - 1, 11, 31, 23, 59, 59);

    // Channel and tier filters
    const channelFilter: SalesChannel[] | undefined =
      filters.channel === "amazon" ? ["amazon_1p", "amazon_di", "amazon_df"] :
      filters.channel === "domestic" ? ["domestic"] :
      undefined;
    const tierFilter: SkuTier | undefined = filters.tier === "all" ? undefined : filters.tier as SkuTier;

    // ---- Sales rollups -------------------------------------------------
    const salesYtd = await db.salesRecord.findMany({
      where: {
        saleDate: { gte: startDate, lte: endDate },
        ...(channelFilter ? { channel: { in: channelFilter } } : {}),
        ...(tierFilter ? { sku: { tier: tierFilter } } : {}),
      },
      select: { revenueUsd: true, channel: true },
    });
    const revenueYtd = salesYtd.reduce((s, r) => s + Number(r.revenueUsd ?? 0), 0);

    const priorYtdAgg = await db.salesRecord.aggregate({
      where: {
        saleDate: { gte: priorStart, lte: priorEnd },
        ...(channelFilter ? { channel: { in: channelFilter } } : {}),
        ...(tierFilter ? { sku: { tier: tierFilter } } : {}),
      },
      _sum: { revenueUsd: true },
    });
    const revenuePriorYtd = Number(priorYtdAgg._sum?.revenueUsd ?? 0);
    const revenueDeltaPct = revenuePriorYtd > 0
      ? ((revenueYtd - revenuePriorYtd) / revenuePriorYtd) * 100
      : null;

    // ---- Channel mix monthly ------------------------------------------
    const monthlyRows = await db.salesRecord.findMany({
      where: {
        saleDate: { gte: startDate, lte: endDate },
        ...(channelFilter ? { channel: { in: channelFilter } } : {}),
        ...(tierFilter ? { sku: { tier: tierFilter } } : {}),
      },
      select: { revenueUsd: true, channel: true, periodStartDate: true },
    });
    const monthBuckets = new Map<string, { amazon_1p: number; amazon_di: number; domestic: number; date: Date }>();
    for (const row of monthlyRows) {
      const d = new Date(row.periodStartDate);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = monthBuckets.get(key) ?? {
        amazon_1p: 0, amazon_di: 0, domestic: 0,
        date: new Date(d.getFullYear(), d.getMonth(), 1),
      };
      const rev = Number(row.revenueUsd ?? 0);
      if (row.channel === "amazon_1p" || row.channel === "amazon_df") bucket.amazon_1p += rev;
      else if (row.channel === "amazon_di") bucket.amazon_di += rev;
      else if (row.channel === "domestic") bucket.domestic += rev;
      monthBuckets.set(key, bucket);
    }
    const channelMonthly: ChannelMonthly[] = Array.from(monthBuckets.values())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((b) => ({
        month: monthLabel(b.date),
        amazon_1p: Math.round(b.amazon_1p),
        amazon_di: Math.round(b.amazon_di),
        domestic: Math.round(b.domestic),
      }));
    const monthlyRevenueTrend = channelMonthly.map(
      (m) => m.amazon_1p + m.amazon_di + m.domestic,
    );

    // ---- Tier revenue mix --------------------------------------------
    const tierRows = await db.salesRecord.findMany({
      where: {
        saleDate: { gte: startDate, lte: endDate },
        ...(channelFilter ? { channel: { in: channelFilter } } : {}),
        ...(tierFilter ? { sku: { tier: tierFilter } } : {}),
      },
      select: { revenueUsd: true, sku: { select: { tier: true } } },
    });
    const tierTotals: Record<string, number> = { A: 0, B: 0, C: 0, LP: 0 };
    for (const row of tierRows) {
      tierTotals[row.sku.tier] = (tierTotals[row.sku.tier] ?? 0) + Number(row.revenueUsd ?? 0);
    }
    const tierTotalSum = Object.values(tierTotals).reduce((a, b) => a + b, 0);
    const tierSegments = (["A", "B", "C", "LP"] as const)
      .filter((t) => (tierTotals[t] ?? 0) > 0 || tierTotalSum === 0)
      .map((tier) => ({
        tier,
        revenue: tierTotals[tier] ?? 0,
        pct: tierTotalSum > 0 ? ((tierTotals[tier] ?? 0) / tierTotalSum) * 100 : 0,
      }));

    // ---- Inventory on-hand value (not filtered — balance sheet metric) ----
    const latestSnapshots = await db.$queryRaw<Array<{ sku_id: string; quantity_on_hand: number; factory_cost: string | null }>>`
      SELECT DISTINCT ON (s.sku_id) s.sku_id, s.quantity_on_hand, k.factory_cost
      FROM inventory_snapshots s
      JOIN skus k ON k.id = s.sku_id
      WHERE k.status = 'active'
      ORDER BY s.sku_id, s.snapshot_date DESC
    `;
    const inventoryOnHand = latestSnapshots.reduce(
      (s, x) => s + x.quantity_on_hand * Number(x.factory_cost ?? 0),
      0,
    );

    // ---- Open PO commitment (not filtered — financial position metric) ----
    const openPos = await db.purchaseOrder.findMany({
      where: { status: { in: ["ordered", "in_production", "on_water", "at_port"] } },
      include: {
        lineItems: { select: { quantityOrdered: true, quantityReceived: true, unitCostUsd: true } },
      },
    });
    const openPoCommitment = openPos.reduce(
      (s, po) => s + po.lineItems.reduce(
        (li, item) => {
          const open = Math.max(0, item.quantityOrdered - item.quantityReceived);
          return li + open * Number(item.unitCostUsd ?? 0);
        },
        0,
      ),
      0,
    );

    // ---- Prior inventory snapshot (MoM) ----------------------------------
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const priorSnapshotsRaw = await db.$queryRaw<Array<{ sku_id: string; quantity_on_hand: number; factory_cost: string | null }>>`
      SELECT DISTINCT ON (s.sku_id) s.sku_id, s.quantity_on_hand, k.factory_cost
      FROM inventory_snapshots s
      JOIN skus k ON k.id = s.sku_id
      WHERE k.status = 'active' AND s.snapshot_date <= ${thirtyDaysAgo}
      ORDER BY s.sku_id, s.snapshot_date DESC
    `;
    const priorInventoryOnHand = priorSnapshotsRaw.length > 0
      ? priorSnapshotsRaw.reduce((s, x) => s + x.quantity_on_hand * Number(x.factory_cost ?? 0), 0)
      : null;
    const inventoryDeltaPct = priorInventoryOnHand != null && priorInventoryOnHand > 0
      ? ((inventoryOnHand - priorInventoryOnHand) / priorInventoryOnHand) * 100
      : null;

    // ---- Current recommendations ----------------------------------------
    const recs = await db.reorderRecommendation.findMany({
      where: { isCurrent: true },
      include: {
        sku: { select: { skuCode: true, name: true, tier: true, factoryCost: true } },
        recommendedFactory: { select: { name: true, country: true } },
      },
      orderBy: { weeksOfSupply: "asc" },
    });

    // Apply tier filter to recs in-memory (recs are not channel-specific)
    const filteredRecs = tierFilter ? recs.filter((r) => r.sku.tier === tierFilter) : recs;

    // Revenue at risk
    const revAtRisk = filteredRecs
      .filter((r) => r.decision === "order" && Number(r.weeksOfSupply) < 4)
      .reduce((s, r) => {
        const weeklyRev = Number(r.weeklyDemand ?? 0) * Number(r.sku.factoryCost ?? 0);
        return s + weeklyRev * 8;
      }, 0);

    // Prior run delta for Revenue at Risk
    const priorRunRow = await db.reorderRecommendation.findFirst({
      where: { isCurrent: false },
      orderBy: { calculationDate: "desc" },
      select: { calculationDate: true },
    });
    let revAtRiskDelta: number | null = null;
    if (priorRunRow?.calculationDate) {
      const priorRecs = await db.reorderRecommendation.findMany({
        where: { isCurrent: false, calculationDate: priorRunRow.calculationDate },
        include: { sku: { select: { factoryCost: true, tier: true } } },
      });
      const priorRevAtRisk = priorRecs
        .filter((r) => r.decision === "order" && Number(r.weeksOfSupply) < 4 && (!tierFilter || r.sku.tier === tierFilter))
        .reduce((s, r) => s + Number(r.weeklyDemand ?? 0) * Number(r.sku.factoryCost ?? 0) * 8, 0);
      revAtRiskDelta = revAtRisk - priorRevAtRisk;
    }

    // Factory concentration
    const factoryTotals = new Map<string, number>();
    for (const r of filteredRecs.filter((r) => r.decision === "order")) {
      const factory = r.recommendedFactory?.name ?? "Unassigned";
      const cost = r.adjustedQuantity * Number(r.sku.factoryCost ?? 0);
      factoryTotals.set(factory, (factoryTotals.get(factory) ?? 0) + cost);
    }
    const factoryTotalSum = Array.from(factoryTotals.values()).reduce((a, b) => a + b, 0);
    const factoryRows = Array.from(factoryTotals.entries())
      .map(([factory, cost]) => ({
        factory,
        pct: factoryTotalSum > 0 ? (cost / factoryTotalSum) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);

    // Top stockout risks
    const topStockoutRisks = filteredRecs
      .filter((r) => r.decision === "order" && Number(r.weeksOfSupply) < 6)
      .slice(0, 8)
      .map((r) => ({
        skuId: r.skuId,
        skuCode: r.sku.skuCode,
        skuName: r.sku.name,
        tier: r.sku.tier,
        wos: Number(r.weeksOfSupply),
        targetWos: Number(r.targetWeeksOfSupply),
        qty: r.adjustedQuantity,
        stockoutDate: r.projectedStockoutDate?.toISOString() ?? null,
      }));

    const forecastSummary = await loadForecastSummary(now);

    // ---- Margin by category -------------------------------------------
    const skusWithPricing = await db.sku.findMany({
      where: {
        factoryCost: { not: null },
        basePrice: { not: null },
        ...(tierFilter ? { tier: tierFilter } : {}),
      },
      select: { category: true, factoryCost: true, basePrice: true },
    });
    type CategoryBucket = { totalMargin: number; totalMarkup: number; count: number };
    const catBuckets = new Map<string, CategoryBucket>();
    for (const s of skusWithPricing) {
      const b = Number(s.basePrice);
      const c = Number(s.factoryCost);
      if (b <= 0 || c <= 0) continue;
      const key = s.category?.trim() || "Uncategorized";
      const bucket = catBuckets.get(key) ?? { totalMargin: 0, totalMarkup: 0, count: 0 };
      bucket.totalMargin += ((b - c) / b) * 100;
      bucket.totalMarkup += ((b - c) / c) * 100;
      bucket.count += 1;
      catBuckets.set(key, bucket);
    }
    const marginByCategory = Array.from(catBuckets.entries())
      .map(([category, b]) => ({
        category,
        avgMarginPct: b.totalMargin / b.count,
        avgMarkupPct: b.totalMarkup / b.count,
        skuCount: b.count,
      }))
      .sort((a, b) => b.avgMarginPct - a.avgMarginPct);

    return {
      ok: true as const,
      year,
      isCurrentYear,
      revenueYtd,
      revenueDeltaPct,
      monthlyRevenueTrend,
      inventoryOnHand,
      inventoryDeltaPct,
      openPoCommitment,
      revAtRisk,
      revAtRiskDelta,
      channelMonthly,
      tierSegments,
      factoryRows,
      topStockoutRisks,
      forecastSummary,
      marginByCategory,
      lastRun: recs[0]?.calculationDate ?? null,
    };
  } catch (err) {
    console.error("Failed to load leadership data:", err);
    return { ok: false as const };
  }
}

// Page --------------------------------------------------------------------

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; tier?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const now = new Date();
  const currentYear = now.getFullYear();

  const channel = sp.channel ?? "all";
  const tier = sp.tier ?? "all";
  const periodRaw = sp.period ? parseInt(sp.period, 10) : NaN;
  const period = !isNaN(periodRaw) && periodRaw >= 2020 && periodRaw <= currentYear
    ? String(periodRaw)
    : String(currentYear);

  const data = await loadLeadershipData({ channel, tier, period });

  if (!data.ok) {
    return (
      <div>
        <PageHeader title="Leadership View" />
        <div className="bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-6 py-5">
          <p className="font-semibold text-[var(--c-warning-text)]">Data unavailable</p>
        </div>
      </div>
    );
  }

  const {
    year, isCurrentYear,
    revenueYtd, revenueDeltaPct, monthlyRevenueTrend,
    inventoryOnHand, inventoryDeltaPct,
    openPoCommitment,
    revAtRisk, revAtRiskDelta,
    channelMonthly, tierSegments, factoryRows, topStockoutRisks, forecastSummary, marginByCategory, lastRun,
  } = data;

  const revenueLabel = isCurrentYear ? `Revenue ${year} YTD` : `Revenue ${year}`;
  const deltaLabel = isCurrentYear ? "vs. same period prior year" : "vs. prior year";

  return (
    <div>
      <PageHeader title="Leadership View" />

      <p className="text-sm text-[var(--c-text-tertiary)] mb-6">
        Revenue, channel mix, and supply posture.
        {lastRun && ` Recommendations as of ${fmtDate(lastRun)}.`}
      </p>

      <Suspense>
        <FilterPillsBar channel={channel} tier={tier} period={period} />
      </Suspense>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label={revenueLabel}
          value={fmtUsd(revenueYtd)}
          trend={monthlyRevenueTrend.length > 1
            ? { data: monthlyRevenueTrend, polarity: "good" }
            : undefined}
          delta={revenueDeltaPct != null ? {
            value: `${revenueDeltaPct > 0 ? "+" : ""}${revenueDeltaPct.toFixed(1)}% ${deltaLabel}`,
            direction: revenueDeltaPct >= 0 ? "up" : "down",
            polarity: "good",
          } : undefined}
        />
        <StatCard
          label="Inventory On Hand"
          value={fmtUsd(inventoryOnHand)}
          delta={inventoryDeltaPct != null ? {
            value: `${inventoryDeltaPct > 0 ? "+" : ""}${inventoryDeltaPct.toFixed(1)}% MoM`,
            direction: inventoryDeltaPct > 1 ? "up" : inventoryDeltaPct < -1 ? "down" : "neutral",
            polarity: "good",
          } : undefined}
        />
        <StatCard
          label="Open PO Commitment"
          value={fmtUsd(openPoCommitment)}
        />
        <StatCard
          label="Revenue at Risk"
          value={fmtUsd(revAtRisk)}
          accent={revAtRisk > 0 ? "red" : "default"}
          delta={revAtRiskDelta != null ? {
            value: `${revAtRiskDelta > 0 ? "+" : ""}${fmtUsd(Math.abs(revAtRiskDelta))} vs prior`,
            direction: revAtRiskDelta > 0 ? "up" : revAtRiskDelta < 0 ? "down" : "neutral",
            polarity: "bad",
          } : undefined}
        />
      </div>

      {/* Channel Mix + Tier Revenue Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="lg:col-span-2">
          <ChannelMixChart data={channelMonthly} />
        </div>
        <div>
          <TierRevenueMixCard segments={tierSegments} />
        </div>
      </div>

      {/* Channel Trend + Factory Concentration */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2">
          <ChannelTrendChart data={channelMonthly} />
        </div>
        <div>
          <FactoryConcentrationCard rows={factoryRows} />
        </div>
      </div>

      {/* Forecast Accuracy */}
      {forecastSummary && (
        <Card
          title="Forecast Accuracy"
          subtitle={`Amazon demand forecast vs. actual sales — ${forecastSummary.skuCount} SKUs evaluated`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  <span className={
                    forecastSummary.overallAccuracy >= 90 && forecastSummary.overallAccuracy <= 110
                      ? "text-[var(--c-success-text)]"
                      : forecastSummary.overallAccuracy >= 75 && forecastSummary.overallAccuracy <= 125
                      ? "text-[var(--c-warning-text)]"
                      : "text-[var(--c-error)]"
                  }>
                    {forecastSummary.overallAccuracy}%
                  </span>
                </p>
                <p className="text-xs text-[var(--c-text-tertiary)] mt-0.5">Overall accuracy (100% = perfect)</p>
              </div>
            </div>
            <Link
              href="/forecast-accuracy"
              className="text-sm text-[var(--c-accent)] hover:underline font-medium"
            >
              View full report →
            </Link>
          </div>
        </Card>
      )}

      {/* Top Stockout Risks */}
      {topStockoutRisks.length > 0 && (
        <Card
          title="Top Stockout Risks"
          subtitle="Order-recommended SKUs with the lowest weeks of supply"
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
                  <tr key={r.skuId} className="border-b border-[var(--c-border-row)] even:bg-[var(--c-surface)]">
                    <td className="px-6 py-2">
                      <Link href={`/skus/${r.skuId}`} className="text-[var(--c-accent)] font-medium hover:underline">
                        {r.skuCode}
                      </Link>
                      <p className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[180px]">{r.skuName}</p>
                    </td>
                    <td className="px-4 py-2"><TierBadge tier={r.tier} /></td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span className={r.wos < 4 ? "text-[var(--c-error)] font-semibold" : ""}>
                        {fmtNum(r.wos)}wk
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[var(--c-text-tertiary)]">{fmtNum(r.targetWos)}wk</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmtInt(r.qty)}</td>
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

      {/* Margin by Category */}
      {marginByCategory.length > 0 && (
        <Card
          title="Margin by Category"
          subtitle="Average FOB-cost gross margin and markup per product category (SKUs with both base price and factory cost on file)"
          className="mt-4"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="py-2 font-medium">Category</th>
                <th className="py-2 font-medium text-right">SKUs</th>
                <th className="py-2 font-medium text-right">Avg Gross Margin</th>
                <th className="py-2 font-medium text-right">Avg Markup</th>
              </tr>
            </thead>
            <tbody>
              {marginByCategory.map((row) => (
                <tr key={row.category} className="border-b border-[var(--c-border-row)]">
                  <td className="py-2 font-medium capitalize">{row.category}</td>
                  <td className="py-2 text-right tabular-nums text-[var(--c-text-secondary)]">{row.skuCount}</td>
                  <td className="py-2 text-right tabular-nums font-mono">{row.avgMarginPct.toFixed(1)}%</td>
                  <td className="py-2 text-right tabular-nums font-mono">{row.avgMarkupPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
