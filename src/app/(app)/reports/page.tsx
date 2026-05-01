import { db } from "@/lib/db";
import { Card, StatCard, TierBadge } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { StockoutExport } from "./report-export";
import { ChannelMixChart, ChannelTrendChart, type ChannelMonthly } from "./leadership-charts";
import { TierRevenueMixCard, FactoryConcentrationCard } from "./leadership-mix";

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

async function loadLeadershipData() {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // ---- Sales rollups -------------------------------------------------
    const salesYtd = await db.salesRecord.findMany({
      where: { saleDate: { gte: startOfYear } },
      select: { revenueUsd: true, channel: true },
    });
    const revenueYtd = salesYtd.reduce((s, r) => s + Number(r.revenueUsd ?? 0), 0);

    // Prior year YTD for delta
    const priorStart = new Date(now.getFullYear() - 1, 0, 1);
    const priorEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const priorYtdAgg = await db.salesRecord.aggregate({
      where: { saleDate: { gte: priorStart, lte: priorEnd } },
      _sum: { revenueUsd: true },
    });
    const revenuePriorYtd = Number(priorYtdAgg._sum.revenueUsd ?? 0);
    const revenueDeltaPct = revenuePriorYtd > 0
      ? ((revenueYtd - revenuePriorYtd) / revenuePriorYtd) * 100
      : null;

    // ---- Channel mix monthly (last 6 months) ---------------------------
    const monthlyRows = await db.salesRecord.findMany({
      where: { saleDate: { gte: sixMonthsAgo } },
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
      // Bucket DF in with 1P; DI separate; domestic alone
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

    // ---- Tier revenue mix (last 12 months) ----------------------------
    const tierRows = await db.salesRecord.findMany({
      where: { saleDate: { gte: twelveMonthsAgo } },
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

    // ---- Inventory on-hand value --------------------------------------
    // Use latest snapshot per SKU
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

    // ---- Open PO commitment -------------------------------------------
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

    // ---- Current recommendations (for risk + factory concentration) ---
    const recs = await db.reorderRecommendation.findMany({
      where: { isCurrent: true },
      include: {
        sku: { select: { skuCode: true, name: true, tier: true, factoryCost: true } },
        recommendedFactory: { select: { name: true, country: true } },
      },
      orderBy: { weeksOfSupply: "asc" },
    });

    // Revenue at risk — orderRecs with WoS < 4: estimate annual revenue at risk
    const revAtRisk = recs
      .filter((r) => r.decision === "order" && Number(r.weeksOfSupply) < 4)
      .reduce((s, r) => {
        const weeklyRev = Number(r.weeklyDemand ?? 0) * Number(r.sku.factoryCost ?? 0);
        return s + weeklyRev * 8; // ~2-month exposure window
      }, 0);

    // Factory concentration — by % of total order cost
    const factoryTotals = new Map<string, number>();
    for (const r of recs.filter((r) => r.decision === "order")) {
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

    // Top stockout risks (kept from previous page, lower in hierarchy)
    const topStockoutRisks = recs
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

    return {
      ok: true as const,
      revenueYtd,
      revenueDeltaPct,
      inventoryOnHand,
      openPoCommitment,
      revAtRisk,
      channelMonthly,
      tierSegments,
      factoryRows,
      topStockoutRisks,
      lastRun: recs[0]?.calculationDate ?? null,
    };
  } catch (err) {
    console.error("Failed to load leadership data:", err);
    return { ok: false as const };
  }
}

// Page --------------------------------------------------------------------

export default async function ReportsPage() {
  const data = await loadLeadershipData();

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
    revenueYtd, revenueDeltaPct, inventoryOnHand, openPoCommitment, revAtRisk,
    channelMonthly, tierSegments, factoryRows, topStockoutRisks, lastRun,
  } = data;

  return (
    <div>
      <PageHeader title="Leadership View" />

      <p className="text-sm text-[var(--c-text-tertiary)] mb-6">
        Revenue, channel mix, and supply posture.
        {lastRun && ` Data as of ${fmtDate(lastRun)}.`}
      </p>

      {/* Filter row */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <FilterPill label="All Channels" />
        <FilterPill label="All Tiers" />
        <FilterPill label={`YTD ${new Date().getFullYear()}`} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Revenue YTD"
          value={fmtUsd(revenueYtd)}
          delta={revenueDeltaPct != null ? {
            value: `${revenueDeltaPct > 0 ? "+" : ""}${revenueDeltaPct.toFixed(1)}%`,
            direction: revenueDeltaPct >= 0 ? "up" : "down",
            polarity: "good",
          } : undefined}
        />
        <StatCard
          label="Inventory On Hand"
          value={fmtUsd(inventoryOnHand)}
          sub="warehouse value"
        />
        <StatCard
          label="Open PO Commitment"
          value={fmtUsd(openPoCommitment)}
          sub="pending receipts"
        />
        <StatCard
          label="Revenue at Risk"
          value={fmtUsd(revAtRisk)}
          accent={revAtRisk > 0 ? "red" : "default"}
          sub="from stockouts < 4w"
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

      {/* Operational detail (kept for buyer reference) */}
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
    </div>
  );
}

function FilterPill({ label }: { label: string }) {
  return (
    <button className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-[var(--c-border)] bg-[var(--c-card-bg)] text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-surface)] transition-colors">
      {label}
      <svg className="w-3.5 h-3.5 text-[var(--c-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}
