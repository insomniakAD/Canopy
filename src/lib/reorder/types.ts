// ============================================================================
// Reorder Recommendation Engine — Shared Types
// ============================================================================

import type { SkuCalculationResult } from "@/lib/engine/types";
import type { FclHint } from "./container";

/** Full recommendation for a single SKU */
export interface SkuRecommendation {
  skuId: string;
  skuCode: string;
  decision: "order" | "do_not_order" | "watch";

  // --- Canopy's numbers ---
  weeklyDemand: number;
  onHandInventory: number;
  inboundInventory: number;
  projectedInventoryAtArrival: number;
  weeksOfSupply: number;
  targetWeeksOfSupply: number;
  leadTimeDays: number;
  leadTimeDemand: number;
  safetyStock: number;
  requiredInventoryLevel: number;
  reorderQuantity: number;       // Raw calculated
  adjustedQuantity: number;      // After MOQ and rounding

  // --- Amazon comparison ---
  amazonForecastWeekly: number | null;
  amazonForecastOrderQty: number | null;
  forecastVariancePct: number | null;

  // --- Amazon DOI (V2) ---
  amazonOnHand: number | null;
  amazonDailyVelocity: number | null;
  amazonDoi: number | null;
  amazonTargetDoi: number | null;
  woodinvilleExposure: number | null;
  diSharePct: number | null;
  diHealthStatus: string | null;

  // --- Operational ---
  recommendedFactoryId: string | null;
  recommendedFactoryName: string | null;
  recommendedOrderByDate: Date | null;
  projectedStockoutDate: Date | null;

  // --- FCL guidance (replaces old CBM/carton math) ---
  fclFractionHQ: number | null;   // adjusted qty / fclQty40HQ (null if unknown)
  fclHint: FclHint;

  // --- Explainability ---
  explanation: string;

  // --- Source data (for the orchestrator) ---
  calcResult: SkuCalculationResult;
}

/** Container planning for a group of SKUs from the same factory */
export interface ContainerPlan {
  factoryId: string;
  factoryName: string;
  country: string;
  skus: ContainerSkuLine[];
  totalUnits: number;
  totalCost: number;
  totalFractionHQ: number;          // Sum of 40HQ fractions (rough load indicator)
  estimatedContainers: number | null; // Ceil of totalFractionHQ, null if no FCL data
}

export interface ContainerSkuLine {
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: number;
  fclQty40GP: number | null;
  fclQty40HQ: number | null;
  fraction40HQ: number | null;    // quantity / fclQty40HQ, rounded to 2 decimals
  hint: FclHint;
  unitCost: number;
  lineCost: number;
}

/** Tier config loaded from database */
export interface TierConfig {
  tier: string;
  targetDaysOfSupply: number;
  safetyStockDays: number;
  amazonTargetDoi: number | null;
}
