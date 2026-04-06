// ============================================================================
// Amazon Forecast Loader
// ============================================================================
// Loads Amazon's forward-looking demand forecast for a SKU.
//
// Amazon provides 48 weeks of weekly forecasts.
// We average the forecasted units over the lead time window
// to get a comparable "weekly demand" figure.
//
// This is displayed alongside Canopy's blended velocity so leadership
// can see both predictions side by side.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Get Amazon's average weekly forecast for a SKU over a future window.
 *
 * @param db - Database client
 * @param skuId - Which SKU
 * @param startDate - Start of the window (typically today)
 * @param daysForward - How far to look ahead (typically lead time)
 * @returns Average weekly forecast, or null if no forecast exists
 */
export async function getAmazonForecastAverage(
  db: PrismaClient,
  skuId: string,
  startDate: Date,
  daysForward: number
): Promise<number | null> {
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + daysForward);

  // Get the most recent forecast snapshot for this SKU
  const latestSnapshot = await db.amazonForecast.findFirst({
    where: { skuId },
    orderBy: { snapshotDate: "desc" },
    select: { snapshotDate: true },
  });

  if (!latestSnapshot) return null;

  // Get all forecast weeks from that snapshot within our window
  const forecasts = await db.amazonForecast.findMany({
    where: {
      skuId,
      snapshotDate: latestSnapshot.snapshotDate,
      weekStartDate: { gte: startDate },
      weekEndDate: { lte: endDate },
    },
    orderBy: { weekNumber: "asc" },
  });

  if (forecasts.length === 0) return null;

  // Average the weekly forecasts
  const total = forecasts.reduce((sum, f) => sum + Number(f.forecastUnits), 0);
  return total / forecasts.length;
}
