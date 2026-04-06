// ============================================================================
// Explanation Generator
// ============================================================================
// Produces plain English explanations for every recommendation.
// This powers the "Why this recommendation?" panel in the UI.
//
// Every number referenced in the explanation is a number the user can
// find in the data. No hidden math. No black boxes.
// ============================================================================

import type { SkuRecommendation } from "./types";
import type { OrderTiming } from "./factory-and-timing";

/**
 * Generate a plain English explanation for a recommendation.
 */
export function generateExplanation(
  rec: Omit<SkuRecommendation, "explanation" | "calcResult">,
  timing: OrderTiming
): string {
  const lines: string[] = [];

  // --- Header ---
  if (rec.decision === "order") {
    lines.push(`RECOMMENDATION: Order ${rec.adjustedQuantity.toLocaleString()} units.`);
  } else if (rec.decision === "watch") {
    lines.push(`RECOMMENDATION: Watch — consider ordering ${rec.adjustedQuantity.toLocaleString()} units soon.`);
  } else {
    lines.push(`RECOMMENDATION: Do not order. Inventory is sufficient.`);
  }

  lines.push("");

  // --- Demand ---
  lines.push(`DEMAND:`);
  lines.push(`  Weekly demand (seasonally adjusted): ${round(rec.weeklyDemand)} units/week`);
  if (rec.amazonForecastWeekly !== null) {
    lines.push(`  Amazon's weekly forecast: ${round(rec.amazonForecastWeekly)} units/week`);
    if (rec.forecastVariancePct !== null) {
      const direction = rec.forecastVariancePct > 0 ? "higher" : "lower";
      lines.push(`  Amazon is ${Math.abs(round(rec.forecastVariancePct))}% ${direction} than Canopy's estimate.`);
    }
  }

  lines.push("");

  // --- Current inventory ---
  lines.push(`CURRENT INVENTORY:`);
  lines.push(`  On-hand (all locations): ${rec.onHandInventory.toLocaleString()} units`);
  lines.push(`  Inbound (open POs): ${rec.inboundInventory.toLocaleString()} units`);
  lines.push(`  Weeks of supply: ${rec.weeksOfSupply} weeks (target: ${round(rec.targetWeeksOfSupply)} weeks)`);

  if (rec.projectedStockoutDate) {
    const stockoutStr = rec.projectedStockoutDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    lines.push(`  Projected stockout: ${stockoutStr}`);
  } else {
    lines.push(`  Projected stockout: None within 12 months`);
  }

  lines.push("");

  // --- Calculation breakdown (only if ordering) ---
  if (rec.decision !== "do_not_order") {
    lines.push(`HOW THE QUANTITY WAS CALCULATED:`);
    lines.push(`  Lead time: ${rec.leadTimeDays} days`);
    lines.push(`  Demand during lead time: ${rec.leadTimeDemand.toLocaleString()} units`);
    lines.push(`  Projected inventory when new order arrives: ${rec.projectedInventoryAtArrival.toLocaleString()} units`);
    lines.push(`  Target inventory level: ${rec.requiredInventoryLevel.toLocaleString()} units (${round(rec.targetWeeksOfSupply)} weeks + safety stock of ${rec.safetyStock.toLocaleString()} units)`);
    lines.push(`  Gap: ${rec.reorderQuantity.toLocaleString()} units`);

    if (rec.adjustedQuantity !== rec.reorderQuantity) {
      lines.push(`  Adjusted to ${rec.adjustedQuantity.toLocaleString()} units (MOQ applied)`);
    }

    if (rec.containerCbmImpact !== null && rec.containerCbmImpact > 0) {
      lines.push(`  Container space: ${rec.containerCbmImpact} CBM`);
    }

    lines.push("");

    // --- Amazon comparison ---
    if (rec.amazonForecastOrderQty !== null && rec.amazonForecastOrderQty > 0) {
      lines.push(`AMAZON COMPARISON:`);
      lines.push(`  If using Amazon's forecast, order quantity would be ${rec.amazonForecastOrderQty.toLocaleString()} units.`);
      const diff = rec.amazonForecastOrderQty - rec.adjustedQuantity;
      if (diff > 0) {
        lines.push(`  That's ${diff.toLocaleString()} more units than Canopy recommends.`);
      } else if (diff < 0) {
        lines.push(`  That's ${Math.abs(diff).toLocaleString()} fewer units than Canopy recommends.`);
      }
      lines.push("");
    }

    // --- Timing ---
    if (rec.recommendedFactoryName) {
      lines.push(`FACTORY: ${rec.recommendedFactoryName}`);
    } else {
      lines.push(`FACTORY: Not assigned — set a default factory for this SKU.`);
    }

    if (timing.orderByDate) {
      const orderByStr = timing.orderByDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      if (timing.urgency === "overdue") {
        lines.push(`TIMING: OVERDUE — should have been ordered by ${orderByStr}.`);
      } else if (timing.urgency === "urgent") {
        lines.push(`TIMING: URGENT — place order by ${orderByStr} (${timing.daysUntilOrderBy} days).`);
      } else {
        lines.push(`TIMING: Place order by ${orderByStr} (${timing.daysUntilOrderBy} days).`);
      }
    }
  }

  return lines.join("\n");
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
