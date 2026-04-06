// ============================================================================
// Reorder Quantity Calculator
// ============================================================================
// The core formula that decides IF and HOW MUCH to order.
//
// Step-by-step logic:
//
//   1. TARGET INVENTORY
//      Weekly Demand × Target Weeks of Supply
//      (Target weeks comes from SKU tier: A=60d, B=40d, C=30d)
//
//   2. SAFETY STOCK
//      Weekly Demand × Safety Stock Weeks
//      (Safety weeks comes from tier config: A=14d, B=10d, C=7d)
//
//   3. REQUIRED INVENTORY LEVEL
//      Target Inventory + Safety Stock
//
//   4. PROJECTED INVENTORY AT ARRIVAL
//      On-Hand + Inbound arriving before cutoff - Lead Time Demand
//      (Calculated by Module 3)
//
//   5. REORDER QUANTITY
//      Required Inventory Level - Projected Inventory at Arrival
//      If negative → Don't order (we have enough)
//      If positive → That's how many units we need
//
//   6. MOQ ADJUSTMENT
//      Round up to minimum order quantity if needed
//
// Every number is visible and traceable. No black boxes.
// ============================================================================

import type { SkuCalculationResult } from "@/lib/engine/types";
import type { TierConfig } from "./types";

export interface ReorderCalcResult {
  targetWeeksOfSupply: number;
  targetInventory: number;
  safetyStockWeeks: number;
  safetyStock: number;
  requiredInventoryLevel: number;
  projectedInventoryAtArrival: number;
  rawReorderQuantity: number;
  adjustedQuantity: number;
  decision: "order" | "do_not_order" | "watch";
}

/**
 * Calculate whether to order and how much.
 *
 * @param calc - Demand and inventory data from Module 3
 * @param tierConfig - Target days and safety stock days from config
 * @param moq - Minimum order quantity for this SKU (null = no minimum)
 */
export function calculateReorderQuantity(
  calc: SkuCalculationResult,
  tierConfig: TierConfig,
  moq: number | null
): ReorderCalcResult {
  const weeklyDemand = calc.demand.seasonallyAdjustedVelocity;

  // --- Step 1: Target inventory ---
  const targetWeeksOfSupply = tierConfig.targetDaysOfSupply / 7;
  const targetInventory = Math.round(weeklyDemand * targetWeeksOfSupply);

  // --- Step 2: Safety stock ---
  const safetyStockWeeks = tierConfig.safetyStockDays / 7;
  const safetyStock = Math.round(weeklyDemand * safetyStockWeeks);

  // --- Step 3: Required inventory level ---
  const requiredInventoryLevel = targetInventory + safetyStock;

  // --- Step 4: Projected inventory at arrival (from Module 3) ---
  const projectedInventoryAtArrival = calc.inventory.projected.inventoryAtArrival;

  // --- Step 5: Reorder quantity ---
  const rawReorderQuantity = requiredInventoryLevel - projectedInventoryAtArrival;

  // --- Step 6: Decision ---
  let decision: "order" | "do_not_order" | "watch";
  let adjustedQuantity: number;

  if (rawReorderQuantity <= 0) {
    // We have enough inventory. No order needed.
    decision = "do_not_order";
    adjustedQuantity = 0;
  } else {
    // --- Step 6b: MOQ adjustment ---
    adjustedQuantity = rawReorderQuantity;

    if (moq && adjustedQuantity < moq) {
      adjustedQuantity = moq;
    }

    // Determine urgency: order vs watch
    // "watch" = we could use more inventory, but it's not urgent
    // Threshold: if weeks of supply > 60% of target, just watch
    const watchThreshold = targetWeeksOfSupply * 0.6;
    if (calc.inventory.weeksOfSupply > watchThreshold) {
      decision = "watch";
    } else {
      decision = "order";
    }
  }

  return {
    targetWeeksOfSupply,
    targetInventory,
    safetyStockWeeks,
    safetyStock,
    requiredInventoryLevel,
    projectedInventoryAtArrival,
    rawReorderQuantity: Math.max(rawReorderQuantity, 0),
    adjustedQuantity,
    decision,
  };
}

/**
 * Calculate what the reorder quantity would be using Amazon's forecast
 * instead of Canopy's. This is for the comparison panel.
 */
export function calculateAmazonBasedQuantity(
  amazonWeeklyDemand: number,
  tierConfig: TierConfig,
  projectedInventoryAtArrival: number,
  moq: number | null
): number {
  const targetWeeks = tierConfig.targetDaysOfSupply / 7;
  const safetyWeeks = tierConfig.safetyStockDays / 7;
  const required = Math.round(amazonWeeklyDemand * (targetWeeks + safetyWeeks));
  const raw = required - projectedInventoryAtArrival;

  if (raw <= 0) return 0;

  let adjusted = raw;
  if (moq && adjusted < moq) adjusted = moq;
  return adjusted;
}
