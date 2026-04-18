// ============================================================================
// Amazon Days of Inventory (DOI) Calculator
// ============================================================================
// Calculates how many days of stock are available to cover Amazon sell-through.
//
// DOI = (Amazon Warehouse on-hand + WDS Domestic on-hand) / Amazon daily sell-through
//
// Why sum both locations:
//   Winsome cannot freely transfer WDS stock to Amazon — Amazon issues POs on
//   their own cadence. But WDS stock does fulfill Amazon DF orders AND is the
//   backing pool that future 1P POs will pull from. So the combined pool is
//   what ultimately covers Amazon-channel demand until the next factory run.
//
// Amazon DOI targets are set by tier (from SkuTierRule.amazonTargetDoi):
//   A = 60 days, B = 50 days, C = 40 days, LP = 30 days
//
// Woodinville Exposure = weekly Amazon 1P + DF volume Woodinville must cover
// (DI is excluded — DI ships directly from factory to Amazon).
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
 *
 * @param amazonOnHand     Units in Amazon Warehouse (1P)
 * @param woodinvilleOnHand Units in WDS Domestic (Woodinville Warehouse)
 */
export async function calculateAmazonDoi(
  db: PrismaClient,
  skuId: string,
  tier: string,
  channelVelocity: { amazon1p: number; amazonDf: number; amazonDi: number; domestic: number },
  amazonOnHand: number,
  woodinvilleOnHand: number
): Promise<AmazonDoiAnalysis> {
  // Load tier rule for DOI target
  const tierRule = await db.skuTierRule.findUnique({ where: { tier: tier as "A" | "B" | "C" | "LP" } });
  const amazonTargetDoi = tierRule?.amazonTargetDoi ?? DEFAULT_DOI_TARGETS[tier] ?? 40;

  // Total Amazon velocity (all 3 channels)
  const totalAmazonWeekly = channelVelocity.amazon1p + channelVelocity.amazonDf + channelVelocity.amazonDi;
  const amazonDailyVelocity = totalAmazonWeekly / 7;

  // Combined on-hand pool covering Amazon demand.
  const combinedOnHand = Math.max(0, amazonOnHand) + Math.max(0, woodinvilleOnHand);

  // DOI calculation — combined pool over Amazon sell-through.
  const amazonDoi = amazonDailyVelocity > 0
    ? combinedOnHand / amazonDailyVelocity
    : combinedOnHand > 0 ? 999 : 0;

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
    woodinvilleOnHand,
    combinedOnHand,
    amazonDailyVelocity: Math.round(amazonDailyVelocity * 10) / 10,
    amazonDoi: Math.round(amazonDoi * 10) / 10,
    amazonTargetDoi,
    woodinvilleExposure: Math.round(woodinvilleExposure * 10) / 10,
    diSharePct: Math.round(diSharePct * 10) / 10,
    diHealthStatus,
  };
}
