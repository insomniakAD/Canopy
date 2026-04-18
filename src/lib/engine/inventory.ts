// ============================================================================
// Network Inventory Calculator
// ============================================================================
// Calculates the complete inventory position for a SKU across all locations.
//
// Three categories of inventory:
//
// 1. ON-HAND — physically available today
//    Woodinville Warehouse + Amazon FC (1P + DI combined)
//
// 2. INBOUND — ordered but not yet received
//    Open POs in stages: ordered, in_production, on_water, at_port
//    Each has an estimated arrival date
//
// 3. PROJECTED AT ARRIVAL — what we'll have when a new order would arrive
//    On-Hand + Inbound (arriving before cutoff) - Demand During Lead Time
//
// Also calculates:
//    - Weeks of Supply = Total On-Hand / Weekly Demand
//    - Projected Stockout Date = when inventory hits zero at current velocity
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import type { SkuInventoryPosition, InboundShipment } from "./types";

/** PO statuses that count as "inbound" — goods we've ordered but don't have yet */
const INBOUND_STATUSES = ["ordered", "in_production", "on_water", "at_port"] as const;

/**
 * Calculate the full inventory position for one SKU.
 *
 * Kit Parents are handled separately — they have no physical inventory of
 * their own. Their "effective on-hand" is derived from their Children at the
 * WDS Domestic location only (Amazon WH does not carry kits).
 *
 * @param db - Database client
 * @param skuId - Which SKU
 * @param weeklyDemand - Seasonally-adjusted weekly velocity
 * @param leadTimeDays - Total lead time for this SKU's factory/country
 * @param asOfDate - "Today" for calculations
 */
export async function calculateInventoryForSku(
  db: PrismaClient,
  skuId: string,
  skuCode: string,
  weeklyDemand: number,
  leadTimeDays: number,
  asOfDate: Date
): Promise<SkuInventoryPosition> {
  // -------------------------------------------------------
  // 0. KIT PARENT? (virtual SKU — derive on-hand from Children)
  // -------------------------------------------------------
  const skuRow = await db.sku.findUnique({
    where: { id: skuId },
    select: { isKitParent: true },
  });
  if (skuRow?.isKitParent) {
    return calculateParentInventory(db, skuId, skuCode, weeklyDemand, leadTimeDays, asOfDate);
  }

  // -------------------------------------------------------
  // 1. ON-HAND INVENTORY (latest snapshot per location)
  // -------------------------------------------------------
  const latestSnapshots = await db.inventorySnapshot.findMany({
    where: { skuId },
    orderBy: { snapshotDate: "desc" },
    distinct: ["locationId"],
    include: { location: true },
  });

  let woodinville = 0;
  let amazon1p = 0;

  for (const snap of latestSnapshots) {
    const qty = snap.quantityAvailable;
    if (snap.location.name === "Woodinville Warehouse") {
      woodinville = qty;
    } else if (snap.location.name === "Amazon FC") {
      amazon1p = qty;
    }
  }

  const totalOnHand = woodinville + amazon1p;

  // -------------------------------------------------------
  // 2. INBOUND INVENTORY (open POs)
  // -------------------------------------------------------
  const inboundLines = await db.poLineItem.findMany({
    where: {
      skuId,
      purchaseOrder: {
        status: { in: [...INBOUND_STATUSES] },
      },
    },
    include: {
      purchaseOrder: {
        include: { factory: true },
      },
    },
  });

  const inboundShipments: InboundShipment[] = inboundLines.map((line) => ({
    poNumber: line.purchaseOrder.poNumber,
    poStatus: line.purchaseOrder.status,
    skuQuantity: line.quantityOrdered - line.quantityReceived,
    estimatedArrival: line.purchaseOrder.estimatedArrivalDate,
    factoryName: line.purchaseOrder.factory.name,
  }));

  const totalInbound = inboundShipments.reduce(
    (sum, s) => sum + Math.max(s.skuQuantity, 0),
    0
  );

  // Cutoff: only count inbound that arrives before a NEW order would arrive
  // New order arrival = today + lead time
  const newOrderArrival = new Date(asOfDate);
  newOrderArrival.setDate(newOrderArrival.getDate() + leadTimeDays);

  const arrivingBeforeCutoff = inboundShipments
    .filter((s) => s.estimatedArrival && s.estimatedArrival <= newOrderArrival)
    .reduce((sum, s) => sum + Math.max(s.skuQuantity, 0), 0);

  // -------------------------------------------------------
  // 3. PROJECTED INVENTORY AT ARRIVAL
  // -------------------------------------------------------
  // How much will we have when a new order would arrive?
  //
  // Formula:
  //   On-Hand
  //   + Inbound arriving before cutoff
  //   - Demand during lead time
  //
  // If this number is low or negative → we need to order

  const leadTimeWeeks = leadTimeDays / 7;
  const leadTimeDemand = Math.round(weeklyDemand * leadTimeWeeks);
  const inventoryAtArrival = totalOnHand + arrivingBeforeCutoff - leadTimeDemand;

  // -------------------------------------------------------
  // 4. WEEKS OF SUPPLY
  // -------------------------------------------------------
  // How many weeks will current on-hand inventory last?
  const weeksOfSupply = weeklyDemand > 0 ? totalOnHand / weeklyDemand : 999;

  // -------------------------------------------------------
  // 5. PROJECTED STOCKOUT DATE
  // -------------------------------------------------------
  // When does on-hand inventory (plus inbound as it arrives) hit zero?
  const projectedStockoutDate = estimateStockoutDate(
    totalOnHand,
    inboundShipments,
    weeklyDemand,
    asOfDate
  );

  return {
    skuId,
    skuCode,
    onHand: {
      woodinville,
      amazon1p,
      total: totalOnHand,
    },
    inbound: {
      arriving: inboundShipments,
      totalUnits: totalInbound,
      arrivingBeforeCutoff,
    },
    projected: {
      leadTimeDays,
      leadTimeDemand,
      inventoryAtArrival,
    },
    weeksOfSupply: Math.round(weeksOfSupply * 10) / 10, // 1 decimal
    projectedStockoutDate,
  };
}

/**
 * Inventory position for a Kit Parent SKU.
 *
 * Parents are virtual — they hold no physical stock. Their effective on-hand
 * is the most restrictive Child's coverage:
 *   effective_parent_on_hand = MIN( floor(child.WDS_on_hand / qty_per_kit) )
 *     across all Children
 *
 * Only WDS Domestic is considered (Amazon WH does not carry kits).
 * Parents are never ordered as POs — inbound is always zero; "projected at
 * arrival" is simply current effective on-hand minus lead-time demand.
 */
async function calculateParentInventory(
  db: PrismaClient,
  skuId: string,
  skuCode: string,
  weeklyDemand: number,
  leadTimeDays: number,
  asOfDate: Date
): Promise<SkuInventoryPosition> {
  const components = await db.kitComponent.findMany({
    where: { parentSkuId: skuId },
    select: { childSkuId: true, quantityPerKit: true },
  });

  let effectiveOnHand = 0;

  if (components.length > 0) {
    // Find the WDS Domestic location once.
    const wdsLocation = await db.inventoryLocation.findFirst({
      where: { name: "Woodinville Warehouse" },
      select: { id: true },
    });

    let minKits = Infinity;
    for (const c of components) {
      let childQty = 0;
      if (wdsLocation) {
        const snap = await db.inventorySnapshot.findFirst({
          where: { skuId: c.childSkuId, locationId: wdsLocation.id },
          orderBy: { snapshotDate: "desc" },
          select: { quantityAvailable: true },
        });
        childQty = snap?.quantityAvailable ?? 0;
      }
      const kitsFromChild = c.quantityPerKit > 0 ? Math.floor(childQty / c.quantityPerKit) : 0;
      if (kitsFromChild < minKits) minKits = kitsFromChild;
    }
    effectiveOnHand = isFinite(minKits) ? minKits : 0;
  }

  const leadTimeWeeks = leadTimeDays / 7;
  const leadTimeDemand = Math.round(weeklyDemand * leadTimeWeeks);
  const inventoryAtArrival = effectiveOnHand - leadTimeDemand;

  const weeksOfSupply = weeklyDemand > 0 ? effectiveOnHand / weeklyDemand : 999;

  return {
    skuId,
    skuCode,
    onHand: {
      woodinville: effectiveOnHand,
      amazon1p: 0, // Kit Parents are not carried at Amazon WH
      total: effectiveOnHand,
    },
    inbound: {
      arriving: [],
      totalUnits: 0,
      arrivingBeforeCutoff: 0,
    },
    projected: {
      leadTimeDays,
      leadTimeDemand,
      inventoryAtArrival,
    },
    weeksOfSupply: Math.round(weeksOfSupply * 10) / 10,
    projectedStockoutDate: null, // Derived from Children in the reorder engine, not here
  };
}

/**
 * Estimate when inventory will hit zero, accounting for inbound arrivals.
 *
 * Walks forward day by day:
 *   - Subtracts daily demand from current inventory
 *   - Adds inbound units on their estimated arrival dates
 *   - Returns the date when running balance hits zero
 *
 * Returns null if inventory lasts beyond 365 days (effectively no stockout risk).
 */
function estimateStockoutDate(
  onHand: number,
  inbound: InboundShipment[],
  weeklyDemand: number,
  startDate: Date
): Date | null {
  if (weeklyDemand <= 0) return null; // No demand = no stockout

  const dailyDemand = weeklyDemand / 7;
  let runningInventory = onHand;

  // Sort inbound by arrival date
  const sortedInbound = [...inbound]
    .filter((s) => s.estimatedArrival !== null)
    .sort((a, b) => a.estimatedArrival!.getTime() - b.estimatedArrival!.getTime());

  const current = new Date(startDate);
  const maxDays = 365;

  for (let day = 0; day < maxDays; day++) {
    // Add any inbound arriving today
    for (const shipment of sortedInbound) {
      if (
        shipment.estimatedArrival &&
        shipment.estimatedArrival.getTime() <= current.getTime() &&
        shipment.skuQuantity > 0
      ) {
        runningInventory += shipment.skuQuantity;
        shipment.skuQuantity = 0; // Don't count again
      }
    }

    // Subtract daily demand
    runningInventory -= dailyDemand;

    if (runningInventory <= 0) {
      return new Date(current);
    }

    current.setDate(current.getDate() + 1);
  }

  return null; // More than a year out — no urgent stockout risk
}
