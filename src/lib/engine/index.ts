// ============================================================================
// Inventory & Demand Engine — Public API
// ============================================================================
// Usage:
//
//   import { runCalculations, runCalculationForSku } from "@/lib/engine";
//
//   // Recalculate all SKUs (after data import)
//   const results = await runCalculations(db);
//
//   // Recalculate one SKU (on-demand)
//   const result = await runCalculationForSku(db, skuId);
//
// ============================================================================

export { runCalculations, runCalculationForSku } from "./calculate";
export type { CalculationRunResult } from "./calculate";
export type {
  SkuDemandProfile,
  SkuInventoryPosition,
  SkuCalculationResult,
  PeriodVelocity,
  InboundShipment,
} from "./types";
