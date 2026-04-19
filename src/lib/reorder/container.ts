// ============================================================================
// Container Planning Engine — FCL-based guidance
// ============================================================================
// Winsome can't precisely pack containers in the tool — factories confirm
// 40GP vs 40HQ after the PO ships, and each SKU ships 1 unit/carton. Instead
// of CBM math, we rely on per-SKU FCL quantities captured from factory quotes
// (Sku.fclQty40GP / Sku.fclQty40HQ) and compute simple guidance:
//
//   1. Per SKU — what fraction of a 40HQ FCL does this order represent?
//      If near 1.0 (or an integer multiple), the buyer should treat the
//      order as a Full Container Load and round to the FCL qty.
//
//   2. Per factory group — what's the rough total container footprint?
//      We sum the 40HQ fractions across all SKUs for a factory. It's a
//      guide, not a precise pack plan, because factories actually mix
//      SKUs and may swap container type at load time.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { SkuRecommendation, ContainerPlan, ContainerSkuLine } from "./types";

const FCL_ROUND_LOWER = 0.85; // Below this → order is not near a full container
const FCL_ROUND_UPPER = 1.15; // Above this → more than one container

export type FclHint = "lcl" | "round_up_to_fcl" | "fcl" | "multi_fcl" | "unknown";

/**
 * Per-SKU FCL guidance for a given order quantity.
 * Uses 40HQ as the reference size (larger, more common).
 */
export function calculateFclHint(
  quantity: number,
  fclQty40HQ: number | null
): { fraction40HQ: number | null; hint: FclHint } {
  if (!fclQty40HQ || fclQty40HQ <= 0 || quantity <= 0) {
    return { fraction40HQ: null, hint: "unknown" };
  }
  const fraction = quantity / fclQty40HQ;
  if (fraction >= FCL_ROUND_LOWER && fraction <= FCL_ROUND_UPPER) {
    return { fraction40HQ: fraction, hint: "round_up_to_fcl" };
  }
  if (fraction > FCL_ROUND_UPPER) {
    // Near an integer multiple of a full FCL?
    const remainder = fraction - Math.floor(fraction);
    if (remainder >= FCL_ROUND_LOWER || remainder <= 1 - FCL_ROUND_LOWER) {
      return { fraction40HQ: fraction, hint: "multi_fcl" };
    }
    return { fraction40HQ: fraction, hint: "fcl" };
  }
  return { fraction40HQ: fraction, hint: "lcl" };
}

/**
 * Build per-factory container plans. Each plan lists its SKU orders plus a
 * rough container-count estimate based on summed 40HQ fractions.
 */
export async function buildContainerPlans(
  db: PrismaClient,
  recommendations: SkuRecommendation[]
): Promise<ContainerPlan[]> {
  const toOrder = recommendations.filter(
    (r) => r.decision === "order" && r.adjustedQuantity > 0
  );
  if (toOrder.length === 0) return [];

  const skuIds = toOrder.map((r) => r.skuId);
  const skuDetails = await db.sku.findMany({
    where: { id: { in: skuIds } },
    include: { defaultFactory: true },
  });
  const skuMap = new Map(skuDetails.map((s) => [s.id, s]));

  // Group by factory
  const factoryGroups = new Map<string, SkuRecommendation[]>();
  for (const rec of toOrder) {
    const key = rec.recommendedFactoryId ?? "unassigned";
    if (!factoryGroups.has(key)) factoryGroups.set(key, []);
    factoryGroups.get(key)!.push(rec);
  }

  const plans: ContainerPlan[] = [];

  for (const [factoryId, recs] of factoryGroups) {
    const lines: ContainerSkuLine[] = [];
    let totalUnits = 0;
    let totalCost = 0;
    let totalFractionHQ = 0;

    for (const rec of recs) {
      const sku = skuMap.get(rec.skuId);
      if (!sku) continue;

      const fclGp = sku.fclQty40GP ?? null;
      const fclHq = sku.fclQty40HQ ?? null;
      const unitCost = Number(sku.unitCostUsd ?? 0);
      const lineCost = rec.adjustedQuantity * unitCost;
      const { fraction40HQ, hint } = calculateFclHint(rec.adjustedQuantity, fclHq);

      lines.push({
        skuId: rec.skuId,
        skuCode: rec.skuCode,
        skuName: sku.name,
        quantity: rec.adjustedQuantity,
        fclQty40GP: fclGp,
        fclQty40HQ: fclHq,
        fraction40HQ: fraction40HQ != null ? Math.round(fraction40HQ * 100) / 100 : null,
        hint,
        unitCost,
        lineCost: Math.round(lineCost * 100) / 100,
      });

      totalUnits += rec.adjustedQuantity;
      totalCost += lineCost;
      if (fraction40HQ != null) totalFractionHQ += fraction40HQ;
    }

    // Rough container-count estimate (floor-plus-remainder logic).
    // If no SKU had an FCL figure, leave estimatedContainers null.
    const estimatedContainers =
      totalFractionHQ > 0 ? Math.max(1, Math.ceil(totalFractionHQ)) : null;

    let factoryName = "Unassigned";
    let country = "unknown";
    if (factoryId !== "unassigned") {
      const factory = await db.factory.findUnique({ where: { id: factoryId } });
      if (factory) {
        factoryName = factory.name;
        country = factory.country ?? "unknown";
      }
    }

    plans.push({
      factoryId,
      factoryName,
      country,
      skus: lines,
      totalUnits,
      totalCost: Math.round(totalCost * 100) / 100,
      totalFractionHQ: Math.round(totalFractionHQ * 100) / 100,
      estimatedContainers,
    });
  }

  return plans;
}
