// ============================================================================
// Reorder Recommendation Engine — Shared Types
// ============================================================================

import type { SkuCalculationResult } from "@/lib/engine/types";

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

  // --- Operational ---
  recommendedFactoryId: string | null;
  recommendedFactoryName: string | null;
  recommendedOrderByDate: Date | null;
  projectedStockoutDate: Date | null;
  containerCbmImpact: number | null;

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
  totalCbm: number;
  totalUnits: number;
  totalCost: number;
  containerType: "forty_gp" | "forty_hq";
  containerCount: number;
  fillPercentage: number;     // 0-100
  estimatedShippingCost: number;
}

export interface ContainerSkuLine {
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: number;
  cbmPerCarton: number;
  unitsPerCarton: number;
  cartons: number;
  lineCbm: number;
  unitCost: number;
  lineCost: number;
}

/** Tier config loaded from database */
export interface TierConfig {
  tier: string;
  targetDaysOfSupply: number;
  safetyStockDays: number;
}
