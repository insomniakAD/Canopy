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
 *
 * If this SKU is a Kit Component (i.e. a Child in one or more kits), kit-
 * implied demand is added: for each Parent it belongs to, the Parent's sales
 * × qty_per_kit is added to this Child's domestic demand. Parent kit sales
 * are recorded as 1 unit per kit in the WDS export (not cartons), so the
 * multiplier is simply qty_per_kit from kit_components.
 */
export async function calculateDemandForSku(
  db: PrismaClient,
  skuId: string,
  skuCode: string,
  asOfDate: Date,
  seasonalityFactor: number,
  amazonForecastWeekly: number | null
): Promise<SkuDemandProfile> {
  // Pre-load kit memberships (if any) so every period query can reuse them.
  const kitMemberships = await db.kitComponent.findMany({
    where: { childSkuId: skuId },
    select: { parentSkuId: true, quantityPerKit: true },
  });

  const threeMonth = await calculatePeriodVelocity(db, skuId, 13, asOfDate, kitMemberships);
  const sixMonth = await calculatePeriodVelocity(db, skuId, 26, asOfDate, kitMemberships);
  const twelveMonth = await calculatePeriodVelocity(db, skuId, 52, asOfDate, kitMemberships);

  // --- Blended velocity ---
  // Uses whichever periods have data. Falls back gracefully.
  const blendedWeeklyVelocity = computeBlendedVelocity(threeMonth, sixMonth, twelveMonth);

  // --- Channel velocity breakdown (blended across periods) ---
  const channelVelocity = computeBlendedChannelVelocity(threeMonth, sixMonth, twelveMonth);

  // --- Weekly revenue (blended across periods) ---
  const weeklyRevenueUsd = computeBlendedRevenue(threeMonth, sixMonth, twelveMonth);

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
    channelVelocity,
    weeklyRevenueUsd,
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
  asOfDate: Date,
  kitMemberships: { parentSkuId: string; quantityPerKit: number }[] = []
): Promise<PeriodVelocity | null> {
  const endDate = asOfDate;
  const startDate = new Date(asOfDate);
  startDate.setDate(startDate.getDate() - periodWeeks * 7);

  // Find all direct sales records that overlap this period
  const records = await db.salesRecord.findMany({
    where: {
      skuId,
      periodEndDate: { gte: startDate },
      periodStartDate: { lte: endDate },
    },
    orderBy: { periodStartDate: "asc" },
  });

  // Pro-rate and sum
  let totalUnits = 0;
  let totalRevenue = 0;
  const channelUnits = { domestic: 0, amazon_1p: 0, amazon_df: 0, amazon_di: 0 };

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

    // Pro-rate revenue the same way
    if (rec.revenueUsd) {
      totalRevenue += Number(rec.revenueUsd) * fraction;
    }

    const channel = rec.channel as keyof typeof channelUnits;
    if (channel in channelUnits) {
      channelUnits[channel] += proRatedUnits;
    }
  }

  // ---- Kit-implied demand ----
  // For each Parent this SKU is a component of, pull Parent's sales in the
  // window and add (Parent units × qty_per_kit) to this Child's domestic bucket.
  // No revenue is attributed for kit-implied sales — revenue is booked against
  // the Parent, not the Children.
  let kitImpliedUnits = 0;
  if (kitMemberships.length > 0) {
    const parentIds = kitMemberships.map((k) => k.parentSkuId);
    const parentRecords = await db.salesRecord.findMany({
      where: {
        skuId: { in: parentIds },
        periodEndDate: { gte: startDate },
        periodStartDate: { lte: endDate },
      },
    });

    const qtyByParent = new Map(kitMemberships.map((k) => [k.parentSkuId, k.quantityPerKit]));

    for (const rec of parentRecords) {
      const qtyPerKit = qtyByParent.get(rec.skuId) ?? 0;
      if (qtyPerKit <= 0) continue;

      const recStart = rec.periodStartDate > startDate ? rec.periodStartDate : startDate;
      const recEnd = rec.periodEndDate < endDate ? rec.periodEndDate : endDate;
      const overlapDays = daysBetween(recStart, recEnd) + 1;
      const recordDays = daysBetween(rec.periodStartDate, rec.periodEndDate) + 1;
      if (overlapDays <= 0 || recordDays <= 0) continue;

      const fraction = Math.min(overlapDays / recordDays, 1);
      const impliedKits = rec.quantity * fraction;
      const impliedUnits = Math.round(impliedKits * qtyPerKit);

      kitImpliedUnits += impliedUnits;
    }
  }

  totalUnits += kitImpliedUnits;
  channelUnits.domestic += kitImpliedUnits; // Kits ship via Winsome DF / domestic.

  // If there is no signal at all (no direct sales AND no kit-implied demand),
  // return null so the blender treats this period as "no data".
  if (records.length === 0 && kitImpliedUnits === 0) return null;

  const weeklyVelocity = periodWeeks > 0 ? totalUnits / periodWeeks : 0;

  return {
    periodWeeks,
    totalUnits,
    weeklyVelocity,
    startDate,
    endDate,
    channels: channelUnits,
    revenueUsd: totalRevenue,
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

/**
 * Blend channel velocities across periods using the same weights.
 * Returns per-channel units/week.
 */
function computeBlendedChannelVelocity(
  threeMonth: PeriodVelocity | null,
  sixMonth: PeriodVelocity | null,
  twelveMonth: PeriodVelocity | null
): { amazon1p: number; amazonDf: number; amazonDi: number; domestic: number } {
  const channels = ["amazon_1p", "amazon_df", "amazon_di", "domestic"] as const;
  const result = { amazon1p: 0, amazonDf: 0, amazonDi: 0, domestic: 0 };
  const keyMap = { amazon_1p: "amazon1p", amazon_df: "amazonDf", amazon_di: "amazonDi", domestic: "domestic" } as const;

  for (const ch of channels) {
    const parts: { velocity: number; weight: number }[] = [];
    if (threeMonth) parts.push({ velocity: threeMonth.channels[ch] / threeMonth.periodWeeks, weight: BLEND_WEIGHTS.threeMonth });
    if (sixMonth) parts.push({ velocity: sixMonth.channels[ch] / sixMonth.periodWeeks, weight: BLEND_WEIGHTS.sixMonth });
    if (twelveMonth) parts.push({ velocity: twelveMonth.channels[ch] / twelveMonth.periodWeeks, weight: BLEND_WEIGHTS.twelveMonth });

    if (parts.length > 0) {
      const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
      result[keyMap[ch]] = parts.reduce((s, p) => s + p.velocity * (p.weight / totalWeight), 0);
    }
  }

  return result;
}

/**
 * Blend revenue across periods using the same weights.
 * Returns $/week.
 */
function computeBlendedRevenue(
  threeMonth: PeriodVelocity | null,
  sixMonth: PeriodVelocity | null,
  twelveMonth: PeriodVelocity | null
): number {
  const parts: { velocity: number; weight: number }[] = [];
  if (threeMonth && threeMonth.periodWeeks > 0) parts.push({ velocity: threeMonth.revenueUsd / threeMonth.periodWeeks, weight: BLEND_WEIGHTS.threeMonth });
  if (sixMonth && sixMonth.periodWeeks > 0) parts.push({ velocity: sixMonth.revenueUsd / sixMonth.periodWeeks, weight: BLEND_WEIGHTS.sixMonth });
  if (twelveMonth && twelveMonth.periodWeeks > 0) parts.push({ velocity: twelveMonth.revenueUsd / twelveMonth.periodWeeks, weight: BLEND_WEIGHTS.twelveMonth });

  if (parts.length === 0) return 0;
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  return parts.reduce((s, p) => s + p.velocity * (p.weight / totalWeight), 0);
}

/** Days between two dates (absolute) */
function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  return Math.round(Math.abs(b.getTime() - a.getTime()) / msPerDay);
}
