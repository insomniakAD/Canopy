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
    amazon_df: number;         // Units from Direct Fulfillment
    amazon_di: number;         // Units from Direct Import
  };
  revenueUsd: number;         // Revenue in this period (for tiering)
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

  // V2: Channel velocity breakdown (from blended calculation)
  channelVelocity: {
    amazon1p: number;          // Units/week via 1P
    amazonDf: number;          // Units/week via Direct Fulfillment
    amazonDi: number;          // Units/week via Direct Import
    domestic: number;          // Units/week non-Amazon
  };
  weeklyRevenueUsd: number;   // Revenue/week for tiering
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

/** Amazon DOI (Days of Inventory) analysis for one SKU */
export interface AmazonDoiAnalysis {
  amazonOnHand: number;               // Amazon's current inventory
  amazonDailyVelocity: number;        // Amazon sell-through rate (units/day)
  amazonDoi: number;                   // Days of inventory at Amazon
  amazonTargetDoi: number;             // From tier rules
  woodinvilleExposure: number;         // Units/week Woodinville must cover for Amazon
  diSharePct: number;                  // % of Amazon demand fulfilled via DI
  diHealthStatus: DiHealthStatus;      // Overall DI health rating
}

/** DI health status levels */
export type DiHealthStatus = "green" | "blue" | "amber" | "red" | "critical";

/** DI health assessment for a single SKU */
export interface DiHealthAssessment {
  status: DiHealthStatus;
  lastOrderDate: Date | null;
  averageOrderGapDays: number | null;
  daysSinceLastOrder: number | null;
  expectedNextOrderDate: Date | null;
  pendingDiUnits: number;              // DI orders in transit
  diVelocityWeekly: number;            // DI channel velocity
  totalAmazonVelocity: number;         // 1P + DF + DI combined
  diSharePct: number;                  // DI as % of total Amazon
  summary: string;                     // Plain English summary
}

/** Full calculation result for one SKU — combines demand + inventory */
export interface SkuCalculationResult {
  demand: SkuDemandProfile;
  inventory: SkuInventoryPosition;
  amazonDoi?: AmazonDoiAnalysis;
  diHealth?: DiHealthAssessment;
}
