// ============================================================================
// Tier System API
// ============================================================================
// POST /api/tiers/calculate — Run tier calculation (preview or apply)
// POST /api/tiers/apply — Apply a specific snapshot run
// POST /api/tiers/rollback — Rollback to a previous snapshot run
// GET  /api/tiers — List all tier snapshots
// ============================================================================

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/tiers — List tier snapshot runs with their SKU assignments.
 */
export async function GET() {
  try {
    // Get distinct run labels with summary stats
    const snapshots = await prisma.tierSnapshot.findMany({
      orderBy: { calculatedAt: "desc" },
      select: {
        id: true,
        runLabel: true,
        tier: true,
        trailingRevenueUsd: true,
        revenueRankPct: true,
        isActive: true,
        calculatedAt: true,
        sku: { select: { skuCode: true, name: true } },
      },
    });

    // Group by run label
    const runs = new Map<string, {
      runLabel: string;
      calculatedAt: Date;
      isActive: boolean;
      tierCounts: Record<string, number>;
      totalSkus: number;
    }>();

    for (const snap of snapshots) {
      if (!runs.has(snap.runLabel)) {
        runs.set(snap.runLabel, {
          runLabel: snap.runLabel,
          calculatedAt: snap.calculatedAt,
          isActive: snap.isActive,
          tierCounts: { A: 0, B: 0, C: 0, LP: 0 },
          totalSkus: 0,
        });
      }
      const run = runs.get(snap.runLabel)!;
      run.tierCounts[snap.tier] = (run.tierCounts[snap.tier] ?? 0) + 1;
      run.totalSkus++;
    }

    return NextResponse.json({
      runs: Array.from(runs.values()),
      snapshots: snapshots.slice(0, 500), // Limit detail response
    });
  } catch (err) {
    console.error("Tier list error:", err);
    return NextResponse.json({ error: "Failed to load tier snapshots" }, { status: 500 });
  }
}

/**
 * POST /api/tiers — Calculate or apply tiers.
 *
 * Body: { action: "calculate" | "apply" | "rollback", runLabel?: string }
 *
 * "calculate" — Compute tiers from trailing 12-month revenue. Returns preview.
 * "apply" — Make a specific run active (sets SKU.tier and SKU.autoTier).
 * "rollback" — Deactivate current run, reactivate the previous one.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, runLabel } = body;

    if (action === "calculate") {
      return await runTierCalculation();
    }

    if (action === "apply" && runLabel) {
      return await applyTierRun(runLabel);
    }

    if (action === "rollback") {
      return await rollbackTiers();
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("Tier action error:", err);
    return NextResponse.json({ error: "Tier operation failed" }, { status: 500 });
  }
}

/**
 * Calculate tiers from trailing 12-month revenue.
 * A = top 25% of revenue, B = top 50%, C = top 75%, LP = bottom 25%
 */
async function runTierCalculation() {
  // Determine the next run label
  const year = new Date().getFullYear().toString();
  const existingRuns = await prisma.tierSnapshot.findMany({
    where: { runLabel: { startsWith: year } },
    select: { runLabel: true },
    distinct: ["runLabel"],
  });

  let newRunLabel: string;
  if (existingRuns.length === 0) {
    newRunLabel = year;
  } else {
    newRunLabel = `${year}-${existingRuns.length + 1}`;
  }

  // Get 12-month trailing revenue per SKU from sales records
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const skus = await prisma.sku.findMany({
    where: { status: "active" },
    select: { id: true, skuCode: true },
  });

  // Calculate trailing revenue per SKU
  const skuRevenues: { skuId: string; revenue: number }[] = [];
  let totalRevenue = 0;

  for (const sku of skus) {
    const sales = await prisma.salesRecord.findMany({
      where: {
        skuId: sku.id,
        periodStartDate: { gte: twelveMonthsAgo },
      },
      select: { revenueUsd: true, quantity: true },
    });

    // Use revenue if available, otherwise estimate from averageSellingPrice
    let revenue = 0;
    for (const sale of sales) {
      if (sale.revenueUsd) {
        revenue += Number(sale.revenueUsd);
      }
    }

    // If no revenue data, try averageSellingPrice × units
    if (revenue === 0) {
      const skuData = await prisma.sku.findUnique({
        where: { id: sku.id },
        select: { averageSellingPrice: true },
      });
      if (skuData?.averageSellingPrice) {
        const totalUnits = sales.reduce((sum, s) => sum + s.quantity, 0);
        revenue = Number(skuData.averageSellingPrice) * totalUnits;
      }
    }

    skuRevenues.push({ skuId: sku.id, revenue });
    totalRevenue += revenue;
  }

  // Sort by revenue descending
  skuRevenues.sort((a, b) => b.revenue - a.revenue);

  // Assign tiers based on cumulative revenue percentage
  const results: Array<{
    skuId: string;
    tier: "A" | "B" | "C" | "LP";
    trailingRevenueUsd: number;
    revenueRankPct: number;
  }> = [];

  let cumulativeRevenue = 0;
  for (const sr of skuRevenues) {
    cumulativeRevenue += sr.revenue;
    const pct = totalRevenue > 0 ? (cumulativeRevenue / totalRevenue) * 100 : 100;

    let tier: "A" | "B" | "C" | "LP";
    if (pct <= 25) tier = "A";
    else if (pct <= 50) tier = "B";
    else if (pct <= 75) tier = "C";
    else tier = "LP";

    results.push({
      skuId: sr.skuId,
      tier,
      trailingRevenueUsd: Math.round(sr.revenue * 100) / 100,
      revenueRankPct: Math.round(pct * 10) / 10,
    });
  }

  // Save snapshot (NOT active yet — user must apply)
  for (const r of results) {
    await prisma.tierSnapshot.create({
      data: {
        skuId: r.skuId,
        runLabel: newRunLabel,
        tier: r.tier,
        trailingRevenueUsd: r.trailingRevenueUsd,
        revenueRankPct: r.revenueRankPct,
        isActive: false,
      },
    });
  }

  // Summary
  const tierCounts = { A: 0, B: 0, C: 0, LP: 0 };
  for (const r of results) tierCounts[r.tier]++;

  return NextResponse.json({
    success: true,
    runLabel: newRunLabel,
    totalSkus: results.length,
    totalRevenue: Math.round(totalRevenue),
    tierCounts,
    message: `Tier calculation "${newRunLabel}" complete. ${results.length} SKUs tiered. Click "Apply" to activate.`,
  });
}

/**
 * Apply a tier snapshot run — sets SKU.tier and SKU.autoTier.
 */
async function applyTierRun(runLabel: string) {
  // Deactivate all current snapshots
  await prisma.tierSnapshot.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });

  // Activate the specified run
  const snapshots = await prisma.tierSnapshot.findMany({
    where: { runLabel },
  });

  if (snapshots.length === 0) {
    return NextResponse.json({ error: `No snapshots found for run "${runLabel}"` }, { status: 404 });
  }

  for (const snap of snapshots) {
    // Mark snapshot as active
    await prisma.tierSnapshot.update({
      where: { id: snap.id },
      data: { isActive: true },
    });

    // Update SKU tier and autoTier
    await prisma.sku.update({
      where: { id: snap.skuId },
      data: {
        tier: snap.tier,
        autoTier: snap.tier,
      },
    });
  }

  return NextResponse.json({
    success: true,
    message: `Tier run "${runLabel}" applied. ${snapshots.length} SKUs updated.`,
    skusUpdated: snapshots.length,
  });
}

/**
 * Rollback — deactivate current run, reactivate the previous one.
 */
async function rollbackTiers() {
  // Find the current active run
  const activeSnapshot = await prisma.tierSnapshot.findFirst({
    where: { isActive: true },
    select: { runLabel: true },
  });

  if (!activeSnapshot) {
    return NextResponse.json({ error: "No active tier run to rollback from" }, { status: 400 });
  }

  // Deactivate current
  await prisma.tierSnapshot.updateMany({
    where: { runLabel: activeSnapshot.runLabel },
    data: { isActive: false },
  });

  // Find the most recent run before this one
  const previousRun = await prisma.tierSnapshot.findFirst({
    where: {
      runLabel: { not: activeSnapshot.runLabel },
    },
    orderBy: { calculatedAt: "desc" },
    select: { runLabel: true },
  });

  if (previousRun) {
    // Apply previous run
    return applyTierRun(previousRun.runLabel);
  }

  // No previous run — reset all SKUs to C
  await prisma.sku.updateMany({
    where: { status: "active" },
    data: { tier: "C", autoTier: null },
  });

  return NextResponse.json({
    success: true,
    message: "Rolled back. No previous tier run found — all SKUs reset to Tier C.",
  });
}
