// ============================================================================
// Calculation Orchestrator
// ============================================================================
// Runs the full inventory & demand calculation for all active SKUs.
//
// For each SKU:
//   1. Resolve lead time (factory → country → fallback)
//   2. Load Amazon's forecast for the lead time window
//   3. Load seasonality factor for the forward window
//   4. Calculate demand velocity (3mo + 6mo + 12mo → blended → seasonal)
//   5. Calculate inventory position (on-hand + inbound + projected)
//   6. Save demand metrics to database
//
// This is Module 3 output. Module 4 (Reorder Engine) takes these results
// and generates purchasing recommendations.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { SkuCalculationResult } from "./types";
import { calculateDemandForSku } from "./demand";
import { loadSeasonalityFactors, getAverageFactorOverWindow } from "./seasonality";
import { calculateInventoryForSku } from "./inventory";
import { resolveLeadTime } from "./lead-time";
import { getAmazonForecastAverage } from "./amazon-forecast";

export interface CalculationRunResult {
  runDate: Date;
  skusProcessed: number;
  skusSkipped: number;
  results: SkuCalculationResult[];
}

/**
 * Run calculations for all active SKUs.
 * Call this after importing new data to refresh metrics.
 */
export async function runCalculations(
  db: PrismaClient
): Promise<CalculationRunResult> {
  const runDate = new Date();
  runDate.setHours(0, 0, 0, 0);

  // Load seasonality factors once (shared across all SKUs)
  const seasonality = await loadSeasonalityFactors(db);

  // Get all active SKUs
  const skus = await db.sku.findMany({
    where: { status: "active" },
    orderBy: { skuCode: "asc" },
  });

  const results: SkuCalculationResult[] = [];
  let skusSkipped = 0;

  for (const sku of skus) {
    // 1. Resolve lead time
    const leadTime = await resolveLeadTime(db, sku.id);

    // 2. Get Amazon's forecast for the lead time window
    const amazonForecast = await getAmazonForecastAverage(
      db,
      sku.id,
      runDate,
      leadTime.totalDays
    );

    // 3. Get seasonality factor for the forward window
    const seasonalFactor = getAverageFactorOverWindow(
      seasonality,
      runDate,
      leadTime.totalDays
    );

    // 4. Calculate demand velocity
    const demand = await calculateDemandForSku(
      db,
      sku.id,
      sku.skuCode,
      runDate,
      seasonalFactor,
      amazonForecast
    );

    // Skip SKUs with zero demand (no sales history at all)
    if (demand.blendedWeeklyVelocity === 0) {
      skusSkipped++;
      continue;
    }

    // 5. Calculate inventory position
    const inventory = await calculateInventoryForSku(
      db,
      sku.id,
      sku.skuCode,
      demand.seasonallyAdjustedVelocity,
      leadTime.totalDays,
      runDate
    );

    // 6. Save demand metrics to database
    await saveDemandMetrics(db, demand, runDate);

    results.push({ demand, inventory });
  }

  return {
    runDate,
    skusProcessed: results.length,
    skusSkipped,
    results,
  };
}

/**
 * Run calculations for a single SKU (e.g., after viewing its detail page).
 */
export async function runCalculationForSku(
  db: PrismaClient,
  skuId: string
): Promise<SkuCalculationResult | null> {
  const sku = await db.sku.findUnique({ where: { id: skuId } });
  if (!sku) return null;

  const runDate = new Date();
  runDate.setHours(0, 0, 0, 0);

  const seasonality = await loadSeasonalityFactors(db);
  const leadTime = await resolveLeadTime(db, sku.id);

  const amazonForecast = await getAmazonForecastAverage(
    db, sku.id, runDate, leadTime.totalDays
  );

  const seasonalFactor = getAverageFactorOverWindow(
    seasonality, runDate, leadTime.totalDays
  );

  const demand = await calculateDemandForSku(
    db, sku.id, sku.skuCode, runDate, seasonalFactor, amazonForecast
  );

  if (demand.blendedWeeklyVelocity === 0) return null;

  const inventory = await calculateInventoryForSku(
    db, sku.id, sku.skuCode,
    demand.seasonallyAdjustedVelocity,
    leadTime.totalDays,
    runDate
  );

  await saveDemandMetrics(db, demand, runDate);

  return { demand, inventory };
}

/**
 * Persist demand metrics to the database.
 * Stores each velocity period + the blended/seasonal result.
 */
async function saveDemandMetrics(
  db: PrismaClient,
  demand: import("./types").SkuDemandProfile,
  calculatedAt: Date
): Promise<void> {
  // Delete old metrics for this SKU (we recalculate fresh each time)
  await db.demandMetric.deleteMany({ where: { skuId: demand.skuId } });

  const records: Parameters<typeof db.demandMetric.create>[0]["data"][] = [];

  // Individual periods
  for (const [, vel] of Object.entries(demand.velocities)) {
    if (vel) {
      records.push({
        skuId: demand.skuId,
        periodWeeks: vel.periodWeeks,
        weeklyVelocity: vel.weeklyVelocity,
        totalUnits: vel.totalUnits,
        startDate: vel.startDate,
        endDate: vel.endDate,
        blendedVelocity: demand.blendedWeeklyVelocity,
        seasonallyAdjustedVelocity: demand.seasonallyAdjustedVelocity,
        calculatedAt,
      });
    }
  }

  // If no individual periods exist but we have a blended velocity,
  // create a single summary record
  if (records.length === 0 && demand.blendedWeeklyVelocity > 0) {
    records.push({
      skuId: demand.skuId,
      periodWeeks: 0,
      weeklyVelocity: demand.blendedWeeklyVelocity,
      totalUnits: 0,
      startDate: calculatedAt,
      endDate: calculatedAt,
      blendedVelocity: demand.blendedWeeklyVelocity,
      seasonallyAdjustedVelocity: demand.seasonallyAdjustedVelocity,
      calculatedAt,
    });
  }

  for (const data of records) {
    await db.demandMetric.create({ data });
  }
}
