// ============================================================================
// Seasonality Engine
// ============================================================================
// Loads the 12 monthly seasonality factors from the database and
// provides a way to get the factor for any future month.
//
// How it works:
//   - Each month has a multiplier (default 1.0 = normal)
//   - 1.3 = demand is 30% above normal
//   - 0.8 = demand is 20% below normal
//   - You fill these in based on your history
//
// For forward-looking demand, we take the average seasonality factor
// over the lead time window. Example:
//   If lead time is 90 days starting in September,
//   the order would arrive in December.
//   We average the factors for Sep, Oct, Nov, Dec.
//   If Q4 has higher factors, the forecast adjusts up.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";

/** All 12 monthly factors loaded from the database */
export interface SeasonalityFactors {
  /** Indexed 1-12 (January=1, December=12) */
  byMonth: Record<number, number>;
}

/** Load all seasonality factors from the database */
export async function loadSeasonalityFactors(
  db: PrismaClient
): Promise<SeasonalityFactors> {
  const factors = await db.seasonalityFactor.findMany({
    orderBy: { month: "asc" },
  });

  const byMonth: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    byMonth[m] = 1.0; // Default if not found
  }

  for (const f of factors) {
    byMonth[f.month] = Number(f.factor);
  }

  return { byMonth };
}

/**
 * Get the seasonality factor for a specific month.
 * Returns 1.0 if the month isn't configured.
 */
export function getMonthFactor(
  factors: SeasonalityFactors,
  month: number
): number {
  return factors.byMonth[month] ?? 1.0;
}

/**
 * Get the average seasonality factor over a future time window.
 *
 * This is used to adjust demand forecasts for lead time.
 * If you're ordering today and the goods arrive in 90 days,
 * we need to know what demand will look like during those 90 days.
 *
 * @param factors - The 12 monthly factors
 * @param startDate - When the window starts (typically today)
 * @param daysForward - How many days to look ahead (typically lead time)
 * @returns Average seasonality factor across all months touched
 *
 * Example:
 *   startDate = September 1, daysForward = 90
 *   Window covers Sep, Oct, Nov
 *   If factors are Sep=1.0, Oct=1.2, Nov=1.4
 *   Average = (1.0 + 1.2 + 1.4) / 3 = 1.2
 */
export function getAverageFactorOverWindow(
  factors: SeasonalityFactors,
  startDate: Date,
  daysForward: number
): number {
  if (daysForward <= 0) return 1.0;

  // Walk through each day in the window and collect months touched
  const monthDays: Record<number, number> = {}; // month → days in that month within window

  const current = new Date(startDate);
  for (let d = 0; d < daysForward; d++) {
    const month = current.getMonth() + 1; // 1-based
    monthDays[month] = (monthDays[month] || 0) + 1;
    current.setDate(current.getDate() + 1);
  }

  // Weighted average: each month's factor weighted by how many days it covers
  let totalWeightedFactor = 0;
  let totalDays = 0;

  for (const [monthStr, days] of Object.entries(monthDays)) {
    const month = parseInt(monthStr);
    const factor = factors.byMonth[month] ?? 1.0;
    totalWeightedFactor += factor * days;
    totalDays += days;
  }

  return totalDays > 0 ? totalWeightedFactor / totalDays : 1.0;
}
