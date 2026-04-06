// ============================================================================
// Inventory & Demand Engine — Shared Types
// ============================================================================

/** Velocity calculation for a single lookback period */
export interface PeriodVelocity {
  periodWeeks: number;         // 13, 26, or 52
  totalUnits: number;          // Total sold in period
  weeklyVelocity: number;      // units / week
  startDate: Date;
  endDate: Date;
  channels: {
    domestic: number;          // Units from Woodinville
    amazon_1p: number;         // Units from Amazon sell-through
    amazon_di: number;         // Units from Direct Import
  };
}

/** Complete demand profile for one SKU */
export interface SkuDemandProfile {
  skuId: string;
  skuCode: string;
  velocities: {
    threeMonth: PeriodVelocity | null;
    sixMonth: PeriodVelocity | null;
    twelveMonth: PeriodVelocity | null;
  };
  blendedWeeklyVelocity: number;       // Weighted average
  seasonallyAdjustedVelocity: number;  // After seasonality factor
  seasonalityFactor: number;           // The multiplier applied
  amazonForecastWeekly: number | null; // Amazon's forecast for comparison
}

/** Inventory position for one SKU across all locations */
export interface SkuInventoryPosition {
  skuId: string;
  skuCode: string;
  onHand: {
    woodinville: number;
    amazon1p: number;
    total: number;
  };
  inbound: {
    arriving: InboundShipment[];
    totalUnits: number;
    arrivingBeforeCutoff: number;     // Only inbound arriving before new order would
  };
  projected: {
    leadTimeDays: number;
    leadTimeDemand: number;            // Demand during lead time
    inventoryAtArrival: number;        // On-hand + relevant inbound - lead time demand
  };
  weeksOfSupply: number;              // Total on-hand / weekly demand
  projectedStockoutDate: Date | null; // When inventory hits zero
}

/** An inbound shipment (from an open PO) */
export interface InboundShipment {
  poNumber: string;
  poStatus: string;
  skuQuantity: number;
  estimatedArrival: Date | null;
  factoryName: string;
}

/** Full calculation result for one SKU — combines demand + inventory */
export interface SkuCalculationResult {
  demand: SkuDemandProfile;
  inventory: SkuInventoryPosition;
}
