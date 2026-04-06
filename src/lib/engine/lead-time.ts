// ============================================================================
// Lead Time Resolver
// ============================================================================
// Determines the total lead time for a SKU.
//
// Priority:
//   1. Factory-specific lead times (if the SKU's default factory has overrides)
//   2. Country-level defaults (from lead_time_rules config table)
//   3. Fallback: 85 days (conservative estimate)
//
// This is important because lead time drives:
//   - How far ahead we need to forecast demand
//   - When to place orders
//   - How much safety stock to hold
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";

export interface ResolvedLeadTime {
  totalDays: number;
  source: "factory" | "country" | "fallback";
  breakdown: {
    poToProduction: number;
    production: number;
    transit: number;
    portProcessing: number;
  };
}

const FALLBACK_LEAD_TIME: ResolvedLeadTime = {
  totalDays: 85,
  source: "fallback",
  breakdown: { poToProduction: 20, production: 35, transit: 25, portProcessing: 5 },
};

/**
 * Resolve the lead time for a SKU.
 * Checks factory overrides first, then country defaults.
 */
export async function resolveLeadTime(
  db: PrismaClient,
  skuId: string
): Promise<ResolvedLeadTime> {
  // Load SKU with its default factory
  const sku = await db.sku.findUnique({
    where: { id: skuId },
    include: { defaultFactory: true },
  });

  if (!sku) return FALLBACK_LEAD_TIME;

  const factory = sku.defaultFactory;

  // --- Try factory-specific lead times ---
  if (factory && factory.leadTimeProductionDays && factory.leadTimeTransitDays) {
    const poToProd = 20; // Standard unless overridden
    const production = factory.leadTimeProductionDays;
    const transit = factory.leadTimeTransitDays;
    const port = 5; // Standard

    return {
      totalDays: poToProd + production + transit + port,
      source: "factory",
      breakdown: {
        poToProduction: poToProd,
        production,
        transit,
        portProcessing: port,
      },
    };
  }

  // --- Try country-level defaults ---
  if (factory) {
    const countryRule = await db.leadTimeRule.findUnique({
      where: { country: factory.country },
    });

    if (countryRule) {
      return {
        totalDays: countryRule.totalLeadTimeDays,
        source: "country",
        breakdown: {
          poToProduction: countryRule.poToProductionDays,
          production: countryRule.productionDays,
          transit: countryRule.transitDays,
          portProcessing: countryRule.portProcessingDays,
        },
      };
    }
  }

  // --- Fallback ---
  return FALLBACK_LEAD_TIME;
}
