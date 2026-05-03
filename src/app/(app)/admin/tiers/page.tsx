import { prisma } from "@/lib/db";
import { StatCard } from "@/components/ui";
import { TierManager } from "./tier-manager";

// Valid period values
const VALID_MONTHS = [1, 3, 6, 12] as const;
type MonthPeriod = (typeof VALID_MONTHS)[number];

function parseMonths(raw: string | undefined): MonthPeriod {
  const n = parseInt(raw ?? "12", 10);
  return (VALID_MONTHS as readonly number[]).includes(n) ? (n as MonthPeriod) : 12;
}

export default async function AdminTiersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const months = parseMonths(sp.months as string | undefined);

  // Current tier distribution
  const skus = await prisma.sku.findMany({
    where: { status: "active" },
    select: { id: true, skuCode: true, name: true, tier: true, autoTier: true, averageSellingPrice: true },
    orderBy: { skuCode: "asc" },
  });

  const tierCounts = { A: 0, B: 0, C: 0, LP: 0 };
  for (const sku of skus) {
    tierCounts[sku.tier as keyof typeof tierCounts] =
      (tierCounts[sku.tier as keyof typeof tierCounts] ?? 0) + 1;
  }

  // Snapshot runs (summary)
  const snapshots = await prisma.tierSnapshot.findMany({
    orderBy: { calculatedAt: "desc" },
    select: { runLabel: true, isActive: true, calculatedAt: true, tier: true },
  });

  const runMap = new Map<string, {
    runLabel: string;
    calculatedAt: string;
    isActive: boolean;
    tierCounts: Record<string, number>;
    totalSkus: number;
  }>();
  for (const snap of snapshots) {
    if (!runMap.has(snap.runLabel)) {
      runMap.set(snap.runLabel, {
        runLabel: snap.runLabel,
        calculatedAt: snap.calculatedAt.toISOString(),
        isActive: snap.isActive,
        tierCounts: { A: 0, B: 0, C: 0, LP: 0 },
        totalSkus: 0,
      });
    }
    const run = runMap.get(snap.runLabel)!;
    run.tierCounts[snap.tier] = (run.tierCounts[snap.tier] ?? 0) + 1;
    run.totalSkus++;
  }
  const runs = Array.from(runMap.values());

  // Latest snapshot run — load per-SKU detail for the results table
  const latestRunLabel = runs[0]?.runLabel ?? null;
  let resultRows: ResultRow[] = [];

  if (latestRunLabel) {
    const latestSnaps = await prisma.tierSnapshot.findMany({
      where: { runLabel: latestRunLabel },
      select: {
        skuId: true,
        tier: true,
        previousTier: true,
        trailingRevenueUsd: true,
        sku: { select: { skuCode: true, name: true } },
      },
    });

    // Sales aggregates for the selected period
    const periodStart = new Date();
    periodStart.setMonth(periodStart.getMonth() - months);

    const salesAgg = await prisma.salesRecord.groupBy({
      by: ["skuId"],
      where: { periodStartDate: { gte: periodStart } },
      _sum: { revenueUsd: true, quantity: true },
    });
    const salesMap = new Map(
      salesAgg.map((r) => [r.skuId, {
        revenue: Number(r._sum.revenueUsd ?? 0),
        units: r._sum.quantity ?? 0,
      }])
    );

    resultRows = latestSnaps.map((snap) => ({
      skuId: snap.skuId,
      skuCode: snap.sku.skuCode,
      skuName: snap.sku.name,
      calculatedTier: snap.tier,
      previousTier: snap.previousTier ?? null,
      revenue: salesMap.get(snap.skuId)?.revenue ?? 0,
      units: salesMap.get(snap.skuId)?.units ?? 0,
    }));

    // Sort by revenue descending
    resultRows.sort((a, b) => b.revenue - a.revenue);
  }

  return (
    <div>
      <p className="text-sm text-[var(--c-text-tertiary)] mb-5">
        Revenue-based tiering — A = top 25% revenue, B = top 50%, C = top 75%, LP = bottom 25%.
        Run annually.
      </p>

      {/* Current distribution */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {(["A", "B", "C", "LP"] as const).map((tier) => (
          <StatCard key={tier} label={`Tier ${tier}`} value={tierCounts[tier]} />
        ))}
      </div>

      <TierManager
        runs={runs}
        skus={skus.map((s) => ({
          ...s,
          averageSellingPrice: s.averageSellingPrice ? Number(s.averageSellingPrice) : null,
        }))}
        resultRows={resultRows}
        selectedMonths={months}
        latestRunLabel={latestRunLabel}
      />
    </div>
  );
}

export interface ResultRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  calculatedTier: string;
  previousTier: string | null;
  revenue: number;
  units: number;
}
