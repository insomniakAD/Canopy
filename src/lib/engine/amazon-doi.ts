// ============================================================================
// Amazon Days of Inventory (DOI) Calculator
// ============================================================================
// Calculates how many days of inventory Amazon currently holds for a SKU.
//
// DOI = Amazon On-Hand / Amazon Daily Sell-Through
//
// Amazon DOI targets are set by tier (from SkuTierRule.amazonTargetDoi):
//   A = 60 days, B = 50 days, C = 40 days, LP = 30 days
//
// IMPORTANT: Winsome cannot push inventory to Amazon — Amazon issues POs.
// Low DOI is an awareness metric, not an action item. It means:
//   - When Amazon DOES issue a PO, Winsome should have stock ready
//   - If DOI is critically low, a large 1P PO may be coming
//
// Woodinville Exposure = how much weekly volume Woodinville must cover
// for Amazon channels (1P + DF — not DI, since DI ships from factory).
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { AmazonDoiAnalysis } from "./types";

// Fallback DOI targets if no tier rule is configured
const DEFAULT_DOI_TARGETS: Record<string, number> = {
  A: 60,
  B: 50,
  C: 40,
  LP: 30,
};

/**
 * Calculate Amazon DOI for a single SKU.
 */
export async function calculateAmazonDoi(
  db: PrismaClient,
  skuId: string,
  tier: string,
  channelVelocity: { amazon1p: number; amazonDf: number; amazonDi: number; domestic: number },
  amazonOnHand: number
): Promise<AmazonDoiAnalysis> {
  // Load tier rule for DOI target
  const tierRule = await db.skuTierRule.findUnique({ where: { tier: tier as "A" | "B" | "C" | "LP" } });
  const amazonTargetDoi = tierRule?.amazonTargetDoi ?? DEFAULT_DOI_TARGETS[tier] ?? 40;

  // Total Amazon velocity (all 3 channels)
  const totalAmazonWeekly = channelVelocity.amazon1p + channelVelocity.amazonDf + channelVelocity.amazonDi;
  const amazonDailyVelocity = totalAmazonWeekly / 7;

  // DOI calculation
  const amazonDoi = amazonDailyVelocity > 0
    ? amazonOnHand / amazonDailyVelocity
    : amazonOnHand > 0 ? 999 : 0;

  // Woodinville exposure: 1P + DF volume (not DI — DI ships from factory)
  const woodinvilleExposure = channelVelocity.amazon1p + channelVelocity.amazonDf;

  // DI share: what % of Amazon demand comes through DI
  const diSharePct = totalAmazonWeekly > 0
    ? (channelVelocity.amazonDi / totalAmazonWeekly) * 100
    : 0;

  // DI health status (simplified — full assessment is in di-health.ts)
  let diHealthStatus: "green" | "blue" | "amber" | "red" | "critical" = "green";
  if (amazonDoi <= 0) {
    diHealthStatus = "critical";
  } else if (amazonDoi < amazonTargetDoi * 0.3) {
    diHealthStatus = "red";
  } else if (amazonDoi < amazonTargetDoi * 0.6) {
    diHealthStatus = "amber";
  } else if (amazonDoi < amazonTargetDoi * 0.9) {
    diHealthStatus = "blue";
  }

  return {
    amazonOnHand,
    amazonDailyVelocity: Math.round(amazonDailyVelocity * 10) / 10,
    amazonDoi: Math.round(amazonDoi * 10) / 10,
    amazonTargetDoi,
    woodinvilleExposure: Math.round(woodinvilleExposure * 10) / 10,
    diSharePct: Math.round(diSharePct * 10) / 10,
    diHealthStatus,
  };
}
