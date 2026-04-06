// ============================================================================
// Demand Velocity Calculator
// ============================================================================
// Calculates how fast a SKU is selling using actual consumer shipments.
//
// Three lookback windows:
//   - 3 months (13 weeks) — most recent trend
//   - 6 months (26 weeks) — medium-term average
//   - 12 months (52 weeks) — long-term baseline
//
// Blended velocity is a weighted average:
//   3-month × 50% + 6-month × 30% + 12-month × 20%
//
// Why this weighting:
//   Recent sales matter most for purchasing decisions.
//   But longer history prevents overreacting to short-term spikes.
//   Weights are editable in future versions.
//
// Seasonality is applied as a multiplier on the blended velocity
// to produce a forward-looking demand estimate.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { PeriodVelocity, SkuDemandProfile } from "./types";

// Blending weights — how much each period contributes
const BLEND_WEIGHTS = {
  threeMonth: 0.5,
  sixMonth: 0.3,
  twelveMonth: 0.2,
};

/**
 * Calculate demand velocity for a single SKU.
 * Pulls from sales_history and combines all channels.
 */
export async function calculateDemandForSku(
  db: PrismaClient,
  skuId: string,
  skuCode: string,
  asOfDate: Date,
  seasonalityFactor: number,
  amazonForecastWeekly: number | null
): Promise<SkuDemandProfile> {
  const threeMonth = await calculatePeriodVelocity(db, skuId, 13, asOfDate);
  const sixMonth = await calculatePeriodVelocity(db, skuId, 26, asOfDate);
  const twelveMonth = await calculatePeriodVelocity(db, skuId, 52, asOfDate);

  // --- Blended velocity ---
  // Uses whichever periods have data. Falls back gracefully.
  const blendedWeeklyVelocity = computeBlendedVelocity(threeMonth, sixMonth, twelveMonth);

  // --- Seasonality adjustment ---
  const seasonallyAdjustedVelocity = blendedWeeklyVelocity * seasonalityFactor;

  return {
    skuId,
    skuCode,
    velocities: { threeMonth, sixMonth, twelveMonth },
    blendedWeeklyVelocity,
    seasonallyAdjustedVelocity,
    seasonalityFactor,
    amazonForecastWeekly,
  };
}

/**
 * Calculate velocity for a specific lookback period.
 *
 * Logic:
 *   1. Find all sales records where the period overlaps the lookback window
 *   2. For each record, calculate what fraction of its period falls within our window
 *   3. Sum pro-rated units across all records
 *   4. Divide by number of weeks in the lookback window
 *
 * Why pro-rating:
 *   A monthly sales record (e.g., "March: 120 units") might only partially
 *   overlap our 13-week window. If only 2 of 4 weeks of March fall in the
 *   window, we count 60 units, not 120.
 */
async function calculatePeriodVelocity(
  db: PrismaClient,
  skuId: string,
  periodWeeks: number,
  asOfDate: Date
): Promise<PeriodVelocity | null> {
  const endDate = asOfDate;
  const startDate = new Date(asOfDate);
  startDate.setDate(startDate.getDate() - periodWeeks * 7);

  // Find all sales records that overlap this period
  const records = await db.salesRecord.findMany({
    where: {
      skuId,
      periodEndDate: { gte: startDate },
      periodStartDate: { lte: endDate },
    },
    orderBy: { periodStartDate: "asc" },
  });

  if (records.length === 0) return null;

  // Pro-rate and sum
  let totalUnits = 0;
  const channelUnits = { domestic: 0, amazon_1p: 0, amazon_di: 0 };

  for (const rec of records) {
    // Calculate overlap between the record's period and our lookback window
    const recStart = rec.periodStartDate > startDate ? rec.periodStartDate : startDate;
    const recEnd = rec.periodEndDate < endDate ? rec.periodEndDate : endDate;

    const overlapDays = daysBetween(recStart, recEnd) + 1; // +1 inclusive
    const recordDays = daysBetween(rec.periodStartDate, rec.periodEndDate) + 1;

    if (overlapDays <= 0 || recordDays <= 0) continue;

    // Pro-rate: if record covers 30 days but only 15 overlap, take half the units
    const fraction = Math.min(overlapDays / recordDays, 1);
    const proRatedUnits = Math.round(rec.quantity * fraction);

    totalUnits += proRatedUnits;

    const channel = rec.channel as keyof typeof channelUnits;
    if (channel in channelUnits) {
      channelUnits[channel] += proRatedUnits;
    }
  }

  const weeklyVelocity = periodWeeks > 0 ? totalUnits / periodWeeks : 0;

  return {
    periodWeeks,
    totalUnits,
    weeklyVelocity,
    startDate,
    endDate,
    channels: channelUnits,
  };
}

/**
 * Weighted blend of available velocity periods.
 * If a period has no data, its weight is redistributed to other periods.
 *
 * Example with all three available:
 *   3mo: 45 units/wk × 50% = 22.5
 *   6mo: 40 units/wk × 30% = 12.0
 *  12mo: 35 units/wk × 20% =  7.0
 *  Blended = 41.5 units/wk
 *
 * Example with only 3mo and 6mo (new product, <12mo history):
 *   3mo: 45 units/wk × 62.5% = 28.1  (50/(50+30) = 62.5%)
 *   6mo: 40 units/wk × 37.5% = 15.0  (30/(50+30) = 37.5%)
 *  Blended = 43.1 units/wk
 */
function computeBlendedVelocity(
  threeMonth: PeriodVelocity | null,
  sixMonth: PeriodVelocity | null,
  twelveMonth: PeriodVelocity | null
): number {
  const parts: { velocity: number; weight: number }[] = [];

  if (threeMonth) parts.push({ velocity: threeMonth.weeklyVelocity, weight: BLEND_WEIGHTS.threeMonth });
  if (sixMonth) parts.push({ velocity: sixMonth.weeklyVelocity, weight: BLEND_WEIGHTS.sixMonth });
  if (twelveMonth) parts.push({ velocity: twelveMonth.weeklyVelocity, weight: BLEND_WEIGHTS.twelveMonth });

  if (parts.length === 0) return 0;

  // Normalize weights to sum to 1.0
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  return parts.reduce((sum, p) => sum + p.velocity * (p.weight / totalWeight), 0);
}

/** Days between two dates (absolute) */
function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  return Math.round(Math.abs(b.getTime() - a.getTime()) / msPerDay);
}
