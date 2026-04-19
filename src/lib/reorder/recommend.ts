// ============================================================================
// Recommendation Orchestrator
// ============================================================================
// Combines all pieces into the final purchasing recommendation:
//
//   Module 3 output (demand + inventory)
//   → Reorder quantity calculator
//   → Amazon comparison
//   → Factory recommendation
//   → Order timing
//   → Container FCL guidance
//   → Explanation generator
//   → Save to database
//
// This is the heart of Module 4. Everything comes together here.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { SkuCalculationResult } from "@/lib/engine/types";
import { runCalculations } from "@/lib/engine";
import type { SkuRecommendation, TierConfig, ContainerPlan } from "./types";
import { calculateReorderQuantity, calculateAmazonBasedQuantity } from "./quantity";
import { recommendFactory, calculateOrderTiming } from "./factory-and-timing";
import { generateExplanation } from "./explain";
import { calculateFclHint, buildContainerPlans } from "./container";

export interface RecommendationRunResult {
  runDate: Date;
  skusProcessed: number;
  skusSkipped: number;
  recommendations: SkuRecommendation[];
  containerPlans: ContainerPlan[];
  summary: {
    orderCount: number;
    watchCount: number;
    doNotOrderCount: number;
    totalOrderUnits: number;
    totalFractionHQ: number;
  };
}

/**
 * Run the full recommendation pipeline for all active SKUs.
 */
export async function runRecommendations(
  db: PrismaClient
): Promise<RecommendationRunResult> {
  const runDate = new Date();
  runDate.setHours(0, 0, 0, 0);

  // --- Step 1: Run Module 3 calculations ---
  const calcResults = await runCalculations(db);

  // --- Step 2: Load tier configs ---
  const tierConfigs = await loadTierConfigs(db);

  // --- Step 3: Mark old recommendations as not current ---
  await db.reorderRecommendation.updateMany({
    where: { isCurrent: true },
    data: { isCurrent: false },
  });

  // --- Step 4: Generate recommendation for each eligible SKU ---
  // Exclusions:
  //   - Discontinued SKUs (status !== "active") — already filtered upstream
  //     by runCalculations, but we double-check here for safety.
  //   - Kit Parents (isKitParent === true) — Parents are virtual sellable
  //     listings with no physical inventory; they are never manufactured,
  //     so reorder math doesn't apply. Component Children and Standalone
  //     SKUs cover the real ordering.
  const skuMeta = await db.sku.findMany({
    where: { id: { in: calcResults.results.map((r) => r.demand.skuId) } },
    select: { id: true, status: true, isKitParent: true },
  });
  const skuMetaById = new Map(skuMeta.map((s) => [s.id, s]));

  const recommendations: SkuRecommendation[] = [];
  let excludedCount = 0;

  for (const calc of calcResults.results) {
    const meta = skuMetaById.get(calc.demand.skuId);
    if (!meta || meta.status !== "active" || meta.isKitParent) {
      excludedCount++;
      continue;
    }

    const rec = await generateRecommendation(db, calc, tierConfigs, runDate);
    recommendations.push(rec);

    // Save to database
    await saveRecommendation(db, rec, runDate);
  }

  // --- Step 5: Build container plans ---
  const containerPlans = await buildContainerPlans(db, recommendations);

  // --- Step 6: Summary ---
  let orderCount = 0;
  let watchCount = 0;
  let doNotOrderCount = 0;
  let totalOrderUnits = 0;
  let totalFractionHQ = 0;

  for (const rec of recommendations) {
    if (rec.decision === "order") {
      orderCount++;
      totalOrderUnits += rec.adjustedQuantity;
      totalFractionHQ += rec.fclFractionHQ ?? 0;
    } else if (rec.decision === "watch") {
      watchCount++;
    } else {
      doNotOrderCount++;
    }
  }

  return {
    runDate,
    skusProcessed: recommendations.length,
    skusSkipped: calcResults.skusSkipped + excludedCount,
    recommendations,
    containerPlans,
    summary: {
      orderCount,
      watchCount,
      doNotOrderCount,
      totalOrderUnits,
      totalFractionHQ: Math.round(totalFractionHQ * 100) / 100,
    },
  };
}

/**
 * Generate a recommendation for a single SKU.
 */
async function generateRecommendation(
  db: PrismaClient,
  calc: SkuCalculationResult,
  tierConfigs: Map<string, TierConfig>,
  asOfDate: Date
): Promise<SkuRecommendation> {
  // Get SKU details
  const sku = await db.sku.findUnique({ where: { id: calc.demand.skuId } });
  const tier = sku?.tier ?? "C";
  const moq = sku?.moq ?? null;
  const fclQty40HQ = sku?.fclQty40HQ ?? null;

  // Tier config
  const tierConfig = tierConfigs.get(tier) ?? {
    tier: "C",
    targetDaysOfSupply: 30,
    safetyStockDays: 7,
    amazonTargetDoi: 40,
  };

  // --- Reorder quantity ---
  const reorderCalc = calculateReorderQuantity(calc, tierConfig, moq);

  // --- Amazon comparison ---
  let amazonForecastWeekly = calc.demand.amazonForecastWeekly;
  let amazonForecastOrderQty: number | null = null;
  let forecastVariancePct: number | null = null;

  if (amazonForecastWeekly !== null && amazonForecastWeekly > 0) {
    amazonForecastOrderQty = calculateAmazonBasedQuantity(
      amazonForecastWeekly,
      tierConfig,
      reorderCalc.projectedInventoryAtArrival,
      moq
    );

    // Variance: (Amazon - Canopy) / Canopy × 100
    if (calc.demand.seasonallyAdjustedVelocity > 0) {
      forecastVariancePct = Math.round(
        ((amazonForecastWeekly - calc.demand.seasonallyAdjustedVelocity) /
          calc.demand.seasonallyAdjustedVelocity) *
          1000
      ) / 10;
    }
  }

  // --- Factory ---
  const factory = await recommendFactory(db, calc.demand.skuId);

  // --- Timing ---
  const timing = calculateOrderTiming(
    calc.inventory.projectedStockoutDate,
    calc.inventory.projected.leadTimeDays,
    asOfDate
  );

  // --- FCL guidance (fraction of a 40HQ container) ---
  const fclCalc =
    reorderCalc.adjustedQuantity > 0
      ? calculateFclHint(reorderCalc.adjustedQuantity, fclQty40HQ)
      : { fraction40HQ: null, hint: "unknown" as const };

  // Build partial recommendation (without explanation)
  const doi = calc.amazonDoi;
  const partial = {
    skuId: calc.demand.skuId,
    skuCode: calc.demand.skuCode,
    decision: reorderCalc.decision,
    weeklyDemand: Math.round(calc.demand.seasonallyAdjustedVelocity * 10) / 10,
    onHandInventory: calc.inventory.onHand.total,
    inboundInventory: calc.inventory.inbound.totalUnits,
    projectedInventoryAtArrival: reorderCalc.projectedInventoryAtArrival,
    weeksOfSupply: calc.inventory.weeksOfSupply,
    targetWeeksOfSupply: reorderCalc.targetWeeksOfSupply,
    leadTimeDays: calc.inventory.projected.leadTimeDays,
    leadTimeDemand: calc.inventory.projected.leadTimeDemand,
    safetyStock: reorderCalc.safetyStock,
    requiredInventoryLevel: reorderCalc.requiredInventoryLevel,
    reorderQuantity: reorderCalc.rawReorderQuantity,
    adjustedQuantity: reorderCalc.adjustedQuantity,
    amazonForecastWeekly: amazonForecastWeekly ?? null,
    amazonForecastOrderQty,
    forecastVariancePct,
    // V2: Amazon DOI fields
    amazonOnHand: doi?.amazonOnHand ?? null,
    amazonDailyVelocity: doi?.amazonDailyVelocity ?? null,
    amazonDoi: doi?.amazonDoi ?? null,
    amazonTargetDoi: doi?.amazonTargetDoi ?? null,
    woodinvilleExposure: doi?.woodinvilleExposure ?? null,
    diSharePct: doi?.diSharePct ?? null,
    diHealthStatus: calc.diHealth?.status ?? doi?.diHealthStatus ?? null,
    recommendedFactoryId: factory.factoryId,
    recommendedFactoryName: factory.factoryName,
    recommendedOrderByDate: timing.orderByDate,
    projectedStockoutDate: calc.inventory.projectedStockoutDate,
    fclFractionHQ: fclCalc.fraction40HQ != null ? Math.round(fclCalc.fraction40HQ * 100) / 100 : null,
    fclHint: fclCalc.hint,
  };

  // --- Explanation ---
  const explanation = generateExplanation(partial, timing);

  return {
    ...partial,
    explanation,
    calcResult: calc,
  };
}

/**
 * Save a recommendation to the database.
 */
async function saveRecommendation(
  db: PrismaClient,
  rec: SkuRecommendation,
  calculationDate: Date
): Promise<void> {
  await db.reorderRecommendation.create({
    data: {
      skuId: rec.skuId,
      calculationDate,
      decision: rec.decision,
      weeklyDemand: rec.weeklyDemand,
      onHandInventory: rec.onHandInventory,
      inboundInventory: rec.inboundInventory,
      projectedInventoryAtArrival: rec.projectedInventoryAtArrival,
      weeksOfSupply: rec.weeksOfSupply,
      targetWeeksOfSupply: rec.targetWeeksOfSupply,
      leadTimeDays: rec.leadTimeDays,
      leadTimeDemand: rec.leadTimeDemand,
      safetyStock: rec.safetyStock,
      requiredInventoryLevel: rec.requiredInventoryLevel,
      reorderQuantity: rec.reorderQuantity,
      adjustedQuantity: rec.adjustedQuantity,
      amazonForecastWeekly: rec.amazonForecastWeekly,
      amazonForecastOrderQty: rec.amazonForecastOrderQty,
      forecastVariancePct: rec.forecastVariancePct,
      // V2: Amazon DOI fields
      amazonOnHand: rec.amazonOnHand,
      amazonDailyVelocity: rec.amazonDailyVelocity,
      amazonDoi: rec.amazonDoi,
      amazonTargetDoi: rec.amazonTargetDoi,
      woodinvilleExposure: rec.woodinvilleExposure,
      diSharePct: rec.diSharePct,
      diHealthStatus: rec.diHealthStatus,
      recommendedFactoryId: rec.recommendedFactoryId,
      recommendedOrderByDate: rec.recommendedOrderByDate,
      projectedStockoutDate: rec.projectedStockoutDate,
      fclFractionHQ: rec.fclFractionHQ,
      explanation: rec.explanation,
      isCurrent: true,
    },
  });
}

/**
 * Load tier rules + safety stock rules into a lookup map.
 */
async function loadTierConfigs(
  db: PrismaClient
): Promise<Map<string, TierConfig>> {
  const tierRules = await db.skuTierRule.findMany();
  const safetyRules = await db.safetyStockRule.findMany();

  const safetyMap = new Map(safetyRules.map((r) => [r.tier, Number(r.safetyStockDays)]));
  const configs = new Map<string, TierConfig>();

  for (const rule of tierRules) {
    configs.set(rule.tier, {
      tier: rule.tier,
      targetDaysOfSupply: rule.targetDaysOfSupply,
      safetyStockDays: safetyMap.get(rule.tier) ?? 7,
      amazonTargetDoi: rule.amazonTargetDoi,
    });
  }

  return configs;
}
