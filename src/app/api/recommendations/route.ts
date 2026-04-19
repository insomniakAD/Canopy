// ============================================================================
// API Route: /api/recommendations
// ============================================================================
// POST — Run the full recommendation engine (recalculates everything)
// GET  — Fetch the latest saved recommendations
// ============================================================================

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runRecommendations } from "@/lib/reorder";

/**
 * POST /api/recommendations
 * Triggers a full recommendation run: demand → inventory → reorder → containers.
 */
export async function POST() {
  try {
    const results = await runRecommendations(db);

    return Response.json({
      success: true,
      summary: {
        runDate: results.runDate,
        skusProcessed: results.skusProcessed,
        skusSkipped: results.skusSkipped,
        orderCount: results.summary.orderCount,
        watchCount: results.summary.watchCount,
        doNotOrderCount: results.summary.doNotOrderCount,
        totalOrderUnits: results.summary.totalOrderUnits,
        totalFractionHQ: results.summary.totalFractionHQ,
      },
      recommendations: results.recommendations.map((r) => ({
        skuId: r.skuId,
        skuCode: r.skuCode,
        decision: r.decision,
        weeklyDemand: r.weeklyDemand,
        onHandInventory: r.onHandInventory,
        inboundInventory: r.inboundInventory,
        weeksOfSupply: r.weeksOfSupply,
        targetWeeksOfSupply: r.targetWeeksOfSupply,
        projectedInventoryAtArrival: r.projectedInventoryAtArrival,
        reorderQuantity: r.reorderQuantity,
        adjustedQuantity: r.adjustedQuantity,
        amazonForecastWeekly: r.amazonForecastWeekly,
        amazonForecastOrderQty: r.amazonForecastOrderQty,
        forecastVariancePct: r.forecastVariancePct,
        factory: r.recommendedFactoryName,
        orderByDate: r.recommendedOrderByDate,
        projectedStockoutDate: r.projectedStockoutDate,
        fclFractionHQ: r.fclFractionHQ,
        fclHint: r.fclHint,
        explanation: r.explanation,
      })),
      containerPlans: results.containerPlans.map((cp) => ({
        factory: cp.factoryName,
        country: cp.country,
        skuCount: cp.skus.length,
        totalUnits: cp.totalUnits,
        totalFractionHQ: cp.totalFractionHQ,
        estimatedContainers: cp.estimatedContainers,
        totalProductCost: cp.totalCost,
        skus: cp.skus.map((s) => ({
          skuCode: s.skuCode,
          name: s.skuName,
          quantity: s.quantity,
          fclQty40GP: s.fclQty40GP,
          fclQty40HQ: s.fclQty40HQ,
          fraction40HQ: s.fraction40HQ,
          hint: s.hint,
          cost: s.lineCost,
        })),
      })),
    });
  } catch (err) {
    console.error("Recommendation run failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Recommendation run failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/recommendations
 * Returns the latest saved recommendations from the database.
 * Supports query params: ?decision=order&limit=50
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const decisionFilter = searchParams.get("decision");
    const limit = parseInt(searchParams.get("limit") ?? "100");

    const where: Record<string, unknown> = { isCurrent: true };
    if (decisionFilter && ["order", "do_not_order", "watch"].includes(decisionFilter)) {
      where.decision = decisionFilter;
    }

    const recs = await db.reorderRecommendation.findMany({
      where,
      orderBy: [{ decision: "asc" }, { weeksOfSupply: "asc" }],
      take: limit,
      include: {
        sku: { select: { skuCode: true, name: true, tier: true, asin: true } },
        recommendedFactory: { select: { name: true, country: true } },
      },
    });

    return Response.json({
      count: recs.length,
      recommendations: recs.map((r) => ({
        id: r.id,
        skuCode: r.sku.skuCode,
        skuName: r.sku.name,
        tier: r.sku.tier,
        asin: r.sku.asin,
        decision: r.decision,
        weeklyDemand: Number(r.weeklyDemand),
        onHandInventory: r.onHandInventory,
        inboundInventory: r.inboundInventory,
        weeksOfSupply: Number(r.weeksOfSupply),
        targetWeeksOfSupply: Number(r.targetWeeksOfSupply),
        projectedInventoryAtArrival: r.projectedInventoryAtArrival,
        reorderQuantity: r.reorderQuantity,
        adjustedQuantity: r.adjustedQuantity,
        amazonForecastWeekly: r.amazonForecastWeekly ? Number(r.amazonForecastWeekly) : null,
        amazonForecastOrderQty: r.amazonForecastOrderQty,
        forecastVariancePct: r.forecastVariancePct ? Number(r.forecastVariancePct) : null,
        factory: r.recommendedFactory?.name ?? null,
        factoryCountry: r.recommendedFactory?.country ?? null,
        orderByDate: r.recommendedOrderByDate,
        projectedStockoutDate: r.projectedStockoutDate,
        fclFractionHQ: r.fclFractionHQ ? Number(r.fclFractionHQ) : null,
        explanation: r.explanation,
        calculationDate: r.calculationDate,
      })),
    });
  } catch (err) {
    console.error("Failed to load recommendations:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load recommendations" },
      { status: 500 }
    );
  }
}
