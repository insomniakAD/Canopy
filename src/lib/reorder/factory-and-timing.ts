// ============================================================================
// Factory Recommendation & Order Timing
// ============================================================================
//
// FACTORY LOGIC (V1 — simple):
//   Recommend the last factory used for this SKU.
//   If no factory assigned, flag it for manual assignment.
//   Buyers can always override.
//
// ORDER TIMING:
//   When should the PO be placed?
//
//   If stockout is projected:
//     Order By Date = Stockout Date − Lead Time
//     (Place the order early enough that goods arrive before stockout)
//
//   If no stockout projected but order is recommended:
//     Order By Date = today + 30 days (standard planning window)
//
//   Urgency levels:
//     - Overdue: order by date is in the past
//     - Urgent: order within 14 days
//     - Normal: order within 30 days
//     - Low: order within 60+ days
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";

export interface FactoryRecommendation {
  factoryId: string | null;
  factoryName: string | null;
  country: string | null;
  source: "sku_default" | "last_po" | "none";
}

export interface OrderTiming {
  orderByDate: Date | null;
  urgency: "overdue" | "urgent" | "normal" | "low";
  daysUntilOrderBy: number | null;
}

/**
 * Recommend a factory for a SKU.
 * Priority: SKU's default factory → last PO factory → none.
 */
export async function recommendFactory(
  db: PrismaClient,
  skuId: string
): Promise<FactoryRecommendation> {
  // 1. Check SKU's default factory
  const sku = await db.sku.findUnique({
    where: { id: skuId },
    include: { defaultFactory: true },
  });

  if (sku?.defaultFactory && sku.defaultFactory.isActive) {
    return {
      factoryId: sku.defaultFactory.id,
      factoryName: sku.defaultFactory.name,
      country: sku.defaultFactory.country,
      source: "sku_default",
    };
  }

  // 2. Check most recent PO for this SKU
  const lastPoLine = await db.poLineItem.findFirst({
    where: { skuId },
    orderBy: { createdAt: "desc" },
    include: {
      purchaseOrder: {
        include: { factory: true },
      },
    },
  });

  if (lastPoLine?.purchaseOrder.factory && lastPoLine.purchaseOrder.factory.isActive) {
    const factory = lastPoLine.purchaseOrder.factory;
    return {
      factoryId: factory.id,
      factoryName: factory.name,
      country: factory.country,
      source: "last_po",
    };
  }

  // 3. No factory found
  return {
    factoryId: null,
    factoryName: null,
    country: null,
    source: "none",
  };
}

/**
 * Calculate when the order should be placed.
 *
 * Logic:
 *   If we know when stockout will happen:
 *     Order By = Stockout Date - Lead Time
 *   Otherwise:
 *     Order By = Today + 30 days (default planning window)
 */
export function calculateOrderTiming(
  projectedStockoutDate: Date | null,
  leadTimeDays: number,
  asOfDate: Date
): OrderTiming {
  let orderByDate: Date | null = null;

  if (projectedStockoutDate) {
    // Back-calculate: when must we order so goods arrive before stockout?
    orderByDate = new Date(projectedStockoutDate);
    orderByDate.setDate(orderByDate.getDate() - leadTimeDays);
  } else {
    // No stockout projected — use default 30-day planning window
    orderByDate = new Date(asOfDate);
    orderByDate.setDate(orderByDate.getDate() + 30);
  }

  // Calculate urgency
  const daysUntilOrderBy = Math.round(
    (orderByDate.getTime() - asOfDate.getTime()) / 86400000
  );

  let urgency: OrderTiming["urgency"];
  if (daysUntilOrderBy < 0) {
    urgency = "overdue";
  } else if (daysUntilOrderBy <= 14) {
    urgency = "urgent";
  } else if (daysUntilOrderBy <= 30) {
    urgency = "normal";
  } else {
    urgency = "low";
  }

  return { orderByDate, urgency, daysUntilOrderBy };
}
