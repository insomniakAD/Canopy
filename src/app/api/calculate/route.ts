// ============================================================================
// API Route: POST /api/calculate
// ============================================================================
// Triggers the inventory & demand calculation engine.
//
// Two modes:
//   POST /api/calculate              — recalculate all active SKUs
//   POST /api/calculate { skuId }    — recalculate one specific SKU
//
// Returns calculation results including demand velocity, inventory position,
// weeks of supply, and projected stockout dates.
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runCalculations, runCalculationForSku } from "@/lib/engine";

export async function POST(request: NextRequest) {
  try {
    // Check if a specific SKU was requested
    let body: { skuId?: string } = {};
    try {
      body = await request.json();
    } catch {
      // No body = calculate all SKUs
    }

    if (body.skuId) {
      // --- Single SKU calculation ---
      const result = await runCalculationForSku(db, body.skuId);

      if (!result) {
        return Response.json(
          { error: "SKU not found or has no sales history" },
          { status: 404 }
        );
      }

      return Response.json({
        mode: "single",
        sku: result.demand.skuCode,
        demand: {
          threeMonthVelocity: result.demand.velocities.threeMonth?.weeklyVelocity ?? null,
          sixMonthVelocity: result.demand.velocities.sixMonth?.weeklyVelocity ?? null,
          twelveMonthVelocity: result.demand.velocities.twelveMonth?.weeklyVelocity ?? null,
          blendedWeeklyVelocity: round(result.demand.blendedWeeklyVelocity),
          seasonalityFactor: result.demand.seasonalityFactor,
          seasonallyAdjustedVelocity: round(result.demand.seasonallyAdjustedVelocity),
          amazonForecastWeekly: result.demand.amazonForecastWeekly
            ? round(result.demand.amazonForecastWeekly)
            : null,
        },
        inventory: {
          onHand: result.inventory.onHand,
          inbound: {
            totalUnits: result.inventory.inbound.totalUnits,
            arrivingBeforeCutoff: result.inventory.inbound.arrivingBeforeCutoff,
            shipments: result.inventory.inbound.arriving.map((s) => ({
              poNumber: s.poNumber,
              status: s.poStatus,
              quantity: s.skuQuantity,
              estimatedArrival: s.estimatedArrival,
              factory: s.factoryName,
            })),
          },
          projected: {
            leadTimeDays: result.inventory.projected.leadTimeDays,
            leadTimeDemand: result.inventory.projected.leadTimeDemand,
            inventoryAtArrival: result.inventory.projected.inventoryAtArrival,
          },
          weeksOfSupply: result.inventory.weeksOfSupply,
          projectedStockoutDate: result.inventory.projectedStockoutDate,
        },
      });
    } else {
      // --- All SKUs calculation ---
      const results = await runCalculations(db);

      // Return summary + per-SKU results
      return Response.json({
        mode: "all",
        summary: {
          runDate: results.runDate,
          skusProcessed: results.skusProcessed,
          skusSkipped: results.skusSkipped,
        },
        skus: results.results.map((r) => ({
          skuCode: r.demand.skuCode,
          skuId: r.demand.skuId,
          weeklyDemand: round(r.demand.seasonallyAdjustedVelocity),
          amazonForecast: r.demand.amazonForecastWeekly
            ? round(r.demand.amazonForecastWeekly)
            : null,
          onHandTotal: r.inventory.onHand.total,
          inboundTotal: r.inventory.inbound.totalUnits,
          weeksOfSupply: r.inventory.weeksOfSupply,
          projectedStockoutDate: r.inventory.projectedStockoutDate,
          inventoryAtArrival: r.inventory.projected.inventoryAtArrival,
        })),
      });
    }
  } catch (err) {
    console.error("Calculation failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Calculation failed" },
      { status: 500 }
    );
  }
}

function round(n: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
