// ============================================================================
// Container Planning Engine
// ============================================================================
// Groups SKU orders by factory and estimates container requirements.
//
// How it works:
//   1. Takes all SKUs with decision = "order"
//   2. Groups them by recommended factory
//   3. For each factory group, calculates total CBM
//   4. Determines container type (40GP vs 40HQ) and count
//   5. Reports fill percentage so buyers can see if there's room
//
// Container types:
//   40GP = 56 CBM capacity, ~26,000 kg
//   40HQ = 68 CBM capacity, ~26,000 kg
//
// Rules:
//   - All SKUs in one container must come from the same factory
//   - If CBM fits in a 40GP, use 40GP (cheaper)
//   - If CBM exceeds 40GP but fits 40HQ, use 40HQ
//   - If CBM exceeds 40HQ, calculate number of containers needed
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { SkuRecommendation, ContainerPlan, ContainerSkuLine } from "./types";

interface ContainerRuleData {
  containerType: string;
  maxCbm: number;
  maxWeightKg: number;
  costEstimateUsd: number;
}

/**
 * Build container plans by grouping order recommendations by factory.
 */
export async function buildContainerPlans(
  db: PrismaClient,
  recommendations: SkuRecommendation[]
): Promise<ContainerPlan[]> {
  // Only plan for SKUs that should be ordered
  const toOrder = recommendations.filter((r) => r.decision === "order" && r.adjustedQuantity > 0);
  if (toOrder.length === 0) return [];

  // Load container rules
  const containerRules = await db.containerRule.findMany();
  const rules: Record<string, ContainerRuleData> = {};
  for (const r of containerRules) {
    rules[r.containerType] = {
      containerType: r.containerType,
      maxCbm: Number(r.maxCbm),
      maxWeightKg: Number(r.maxWeightKg),
      costEstimateUsd: Number(r.costEstimateUsd ?? 0),
    };
  }

  const gp = rules["forty_gp"];
  const hq = rules["forty_hq"];
  if (!gp || !hq) {
    throw new Error("Container rules not found. Run seed first.");
  }

  // Load SKU details for CBM/carton calculations
  const skuIds = toOrder.map((r) => r.skuId);
  const skuDetails = await db.sku.findMany({
    where: { id: { in: skuIds } },
    include: { defaultFactory: true },
  });
  const skuMap = new Map(skuDetails.map((s) => [s.id, s]));

  // Group by factory
  const factoryGroups = new Map<string, SkuRecommendation[]>();

  for (const rec of toOrder) {
    const factoryKey = rec.recommendedFactoryId ?? "unassigned";
    if (!factoryGroups.has(factoryKey)) {
      factoryGroups.set(factoryKey, []);
    }
    factoryGroups.get(factoryKey)!.push(rec);
  }

  // Build container plan for each factory
  const plans: ContainerPlan[] = [];

  for (const [factoryId, recs] of factoryGroups) {
    const lines: ContainerSkuLine[] = [];
    let totalCbm = 0;
    let totalUnits = 0;
    let totalCost = 0;

    for (const rec of recs) {
      const sku = skuMap.get(rec.skuId);
      if (!sku) continue;

      const cbmPerCarton = Number(sku.cbmPerCarton ?? 0);
      const unitsPerCarton = sku.unitsPerCarton ?? 1;
      const unitCost = Number(sku.unitCostUsd ?? 0);

      // How many cartons needed for this quantity?
      const cartons = unitsPerCarton > 0
        ? Math.ceil(rec.adjustedQuantity / unitsPerCarton)
        : rec.adjustedQuantity;
      const lineCbm = cartons * cbmPerCarton;
      const lineCost = rec.adjustedQuantity * unitCost;

      lines.push({
        skuId: rec.skuId,
        skuCode: rec.skuCode,
        skuName: sku.name,
        quantity: rec.adjustedQuantity,
        cbmPerCarton,
        unitsPerCarton,
        cartons,
        lineCbm: Math.round(lineCbm * 100) / 100,
        unitCost,
        lineCost: Math.round(lineCost * 100) / 100,
      });

      totalCbm += lineCbm;
      totalUnits += rec.adjustedQuantity;
      totalCost += lineCost;
    }

    // Determine container type and count
    let containerType: "forty_gp" | "forty_hq";
    let containerCount: number;
    let maxCbm: number;
    let shippingCostPerContainer: number;

    if (totalCbm <= gp.maxCbm) {
      containerType = "forty_gp";
      containerCount = 1;
      maxCbm = gp.maxCbm;
      shippingCostPerContainer = gp.costEstimateUsd;
    } else if (totalCbm <= hq.maxCbm) {
      containerType = "forty_hq";
      containerCount = 1;
      maxCbm = hq.maxCbm;
      shippingCostPerContainer = hq.costEstimateUsd;
    } else {
      // Need multiple containers — use 40HQ for efficiency
      containerType = "forty_hq";
      containerCount = Math.ceil(totalCbm / hq.maxCbm);
      maxCbm = hq.maxCbm * containerCount;
      shippingCostPerContainer = hq.costEstimateUsd;
    }

    const fillPercentage = maxCbm > 0
      ? Math.round((totalCbm / maxCbm) * 1000) / 10
      : 0;

    // Get factory info
    let factoryName = "Unassigned";
    let country = "unknown";
    if (factoryId !== "unassigned") {
      const factory = await db.factory.findUnique({ where: { id: factoryId } });
      if (factory) {
        factoryName = factory.name;
        country = factory.country;
      }
    }

    plans.push({
      factoryId,
      factoryName,
      country,
      skus: lines,
      totalCbm: Math.round(totalCbm * 100) / 100,
      totalUnits,
      totalCost: Math.round(totalCost * 100) / 100,
      containerType,
      containerCount,
      fillPercentage,
      estimatedShippingCost: containerCount * shippingCostPerContainer,
    });
  }

  return plans;
}

/**
 * Calculate the CBM impact of a single SKU order.
 * Used in the per-SKU recommendation to show container space used.
 */
export function calculateSkuCbmImpact(
  quantity: number,
  cbmPerCarton: number,
  unitsPerCarton: number
): number {
  if (unitsPerCarton <= 0 || cbmPerCarton <= 0) return 0;
  const cartons = Math.ceil(quantity / unitsPerCarton);
  return Math.round(cartons * cbmPerCarton * 100) / 100;
}
