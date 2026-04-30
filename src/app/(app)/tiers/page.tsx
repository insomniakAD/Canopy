import { prisma } from "@/lib/db";
import { Card, StatCard } from "@/components/ui";
import { TierManager } from "./tier-manager";

export default async function TiersPage() {
  // Load current tier distribution
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

  // Load snapshot runs
  const snapshots = await prisma.tierSnapshot.findMany({
    orderBy: { calculatedAt: "desc" },
    select: {
      runLabel: true,
      isActive: true,
      calculatedAt: true,
      tier: true,
    },
  });

  // Group runs
  const runMap = new Map<string, { runLabel: string; calculatedAt: string; isActive: boolean; tierCounts: Record<string, number>; totalSkus: number }>();
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

  return (
    <div>
      <p className="text-sm text-[var(--c-text-tertiary)] mb-5">
        Revenue-based tiering — A = top 25% revenue, B = top 50%, C = top 75%, LP = bottom 25%
      </p>

      {/* Current distribution */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {(["A", "B", "C", "LP"] as const).map((tier) => (
          <StatCard key={tier} label={`Tier ${tier}`} value={tierCounts[tier]} sub="SKUs" />
        ))}
      </div>

      <TierManager
        runs={runs}
        skus={skus.map((s) => ({
          ...s,
          averageSellingPrice: s.averageSellingPrice ? Number(s.averageSellingPrice) : null,
        }))}
      />
    </div>
  );
}
