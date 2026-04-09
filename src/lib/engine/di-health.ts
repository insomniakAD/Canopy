// ============================================================================
// DI Health Assessment
// ============================================================================
// Evaluates the health of Amazon Direct Import for each SKU.
//
// This is NOT a simple order-gap analysis. It uses the full picture:
//   1. DI order cadence (how often Amazon places DI orders for this SKU)
//   2. Retail velocity (how fast the SKU is selling on Amazon)
//   3. Amazon inventory (how much Amazon currently holds)
//   4. Woodinville inventory (Winsome's domestic stock)
//   5. Incoming Winsome inventory (POs in the pipeline)
//
// Health statuses:
//   GREEN    — DI orders are on cadence, Amazon inventory healthy
//   BLUE     — DI running but slightly behind schedule or below target
//   AMBER    — DI gap is growing, or Amazon inventory dropping below target
//   RED      — DI significantly overdue, Amazon DOI critical
//   CRITICAL — No recent DI activity + Amazon inventory depleting fast
//
// IMPORTANT: Winsome cannot push inventory to Amazon. These statuses are
// awareness indicators. When status is red/critical, it means:
//   - Domestic warehouse should have stock ready for a surge in 1P/DF orders
//   - Amazon may be shifting this SKU away from DI
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { DiHealthAssessment, DiHealthStatus } from "./types";

/**
 * Assess DI health for a single SKU.
 */
export async function assessDiHealth(
  db: PrismaClient,
  skuId: string,
  channelVelocity: { amazon1p: number; amazonDf: number; amazonDi: number; domestic: number },
  asOfDate: Date
): Promise<DiHealthAssessment> {
  // Load DI order history for this SKU (most recent first)
  const diOrders = await db.diOrder.findMany({
    where: { skuId },
    orderBy: { orderDate: "desc" },
  });

  const totalAmazonWeekly =
    channelVelocity.amazon1p + channelVelocity.amazonDf + channelVelocity.amazonDi;
  const diVelocityWeekly = channelVelocity.amazonDi;
  const diSharePct = totalAmazonWeekly > 0
    ? (diVelocityWeekly / totalAmazonWeekly) * 100
    : 0;

  // No DI orders at all
  if (diOrders.length === 0) {
    return {
      status: diVelocityWeekly > 0 ? "amber" : "blue",
      lastOrderDate: null,
      averageOrderGapDays: null,
      daysSinceLastOrder: null,
      expectedNextOrderDate: null,
      pendingDiUnits: 0,
      diVelocityWeekly,
      totalAmazonVelocity: totalAmazonWeekly,
      diSharePct: Math.round(diSharePct * 10) / 10,
      summary: "No DI order history found. SKU is marked DI-eligible but no orders have been imported.",
    };
  }

  // --- Order cadence analysis ---
  const lastOrderDate = diOrders[0].orderDate;
  const daysSinceLastOrder = Math.round(
    (asOfDate.getTime() - lastOrderDate.getTime()) / 86400000
  );

  // Calculate average gap between orders
  let averageOrderGapDays: number | null = null;
  if (diOrders.length >= 2) {
    const gaps: number[] = [];
    for (let i = 0; i < diOrders.length - 1; i++) {
      const gap = Math.round(
        (diOrders[i].orderDate.getTime() - diOrders[i + 1].orderDate.getTime()) / 86400000
      );
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length > 0) {
      averageOrderGapDays = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    }
  }

  // Expected next order date (last order + average gap)
  let expectedNextOrderDate: Date | null = null;
  if (averageOrderGapDays !== null) {
    expectedNextOrderDate = new Date(lastOrderDate);
    expectedNextOrderDate.setDate(expectedNextOrderDate.getDate() + averageOrderGapDays);
  }

  // Pending DI units (orders not yet received)
  const pendingStatuses = ["ordered", "in_production", "on_water", "at_port"];
  const pendingDiUnits = diOrders
    .filter((o) => pendingStatuses.includes(o.status))
    .reduce((sum, o) => sum + o.quantity, 0);

  // --- Determine health status ---
  let status: DiHealthStatus = "green";
  const summaryParts: string[] = [];

  if (averageOrderGapDays !== null) {
    const overdueDays = daysSinceLastOrder - averageOrderGapDays;
    const overdueRatio = averageOrderGapDays > 0 ? daysSinceLastOrder / averageOrderGapDays : 1;

    if (overdueRatio > 2.0) {
      // More than 2x the average gap — critical
      status = "critical";
      summaryParts.push(
        `Last DI order was ${daysSinceLastOrder} days ago (avg gap: ${averageOrderGapDays}d). Over 2x the normal cadence.`
      );
    } else if (overdueRatio > 1.5) {
      status = "red";
      summaryParts.push(
        `Last DI order was ${daysSinceLastOrder} days ago (avg gap: ${averageOrderGapDays}d). Significantly overdue.`
      );
    } else if (overdueDays > 7) {
      status = "amber";
      summaryParts.push(
        `Last DI order was ${daysSinceLastOrder} days ago (avg gap: ${averageOrderGapDays}d). Slightly overdue.`
      );
    } else if (overdueDays > 0) {
      status = "blue";
      summaryParts.push(
        `DI running on schedule. Last order ${daysSinceLastOrder} days ago (avg gap: ${averageOrderGapDays}d).`
      );
    } else {
      summaryParts.push(
        `DI on cadence. Last order ${daysSinceLastOrder} days ago (avg gap: ${averageOrderGapDays}d).`
      );
    }
  } else {
    // Only one DI order — not enough history to assess cadence
    status = "blue";
    summaryParts.push(
      `Only 1 DI order on record (${daysSinceLastOrder} days ago). Need more history to assess cadence.`
    );
  }

  if (pendingDiUnits > 0) {
    summaryParts.push(`${pendingDiUnits.toLocaleString()} DI units currently in pipeline.`);
  }

  if (diSharePct > 0) {
    summaryParts.push(`DI accounts for ${Math.round(diSharePct)}% of total Amazon volume.`);
  }

  // Escalate status if DI share is high but orders have dried up
  if (diSharePct > 30 && status === "amber") {
    status = "red";
    summaryParts.push("High DI dependency — Woodinville should prepare for increased 1P/DF volume.");
  }

  return {
    status,
    lastOrderDate,
    averageOrderGapDays,
    daysSinceLastOrder,
    expectedNextOrderDate,
    pendingDiUnits,
    diVelocityWeekly: Math.round(diVelocityWeekly * 10) / 10,
    totalAmazonVelocity: Math.round(totalAmazonWeekly * 10) / 10,
    diSharePct: Math.round(diSharePct * 10) / 10,
    summary: summaryParts.join(" "),
  };
}
