// ============================================================================
// API Route: PUT /api/settings
// ============================================================================
// Updates a single configuration value in one of the settings tables.
//
// Request JSON: { table, id, field, value }
//   - table: which config table to update
//   - id:    UUID of the record
//   - field: which column to update
//   - value: the new numeric value (must be a positive number)
//
// Response: { success: true } or { success: false, error: "message" }
// ============================================================================

import { db } from "@/lib/db";

const VALID_TABLES = [
  "sku_tier_rules",
  "safety_stock_rules",
  "lead_time_rules",
  "container_rules",
  "seasonality_factors",
] as const;

type ValidTable = (typeof VALID_TABLES)[number];

/** Which numeric fields can be edited on each table. */
const EDITABLE_FIELDS: Record<ValidTable, string[]> = {
  sku_tier_rules: ["targetDaysOfSupply"],
  safety_stock_rules: ["safetyStockDays"],
  lead_time_rules: [
    "poToProductionDays",
    "productionDays",
    "transitDays",
    "portProcessingDays",
  ],
  container_rules: ["maxCbm", "maxWeightKg", "costEstimateUsd"],
  seasonality_factors: ["factor"],
};

/** Fields stored as Decimal in the database (Prisma expects a number/string). */
const DECIMAL_FIELDS = new Set([
  "maxCbm",
  "maxWeightKg",
  "costEstimateUsd",
  "factor",
]);

/** Fields stored as Int in the database. */
const INT_FIELDS = new Set([
  "targetDaysOfSupply",
  "safetyStockDays",
  "poToProductionDays",
  "productionDays",
  "transitDays",
  "portProcessingDays",
]);

function isValidTable(t: string): t is ValidTable {
  return (VALID_TABLES as readonly string[]).includes(t);
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { table, id, field, value } = body;

    // --- Validate table ---
    if (!table || typeof table !== "string" || !isValidTable(table)) {
      return Response.json(
        { success: false, error: `Invalid table. Expected one of: ${VALID_TABLES.join(", ")}` },
        { status: 400 }
      );
    }

    // --- Validate id ---
    if (!id || typeof id !== "string") {
      return Response.json(
        { success: false, error: "Missing or invalid record id." },
        { status: 400 }
      );
    }

    // --- Validate field ---
    const allowed = EDITABLE_FIELDS[table];
    if (!field || typeof field !== "string" || !allowed.includes(field)) {
      return Response.json(
        { success: false, error: `Field "${field}" is not editable on ${table}. Allowed: ${allowed.join(", ")}` },
        { status: 400 }
      );
    }

    // --- Validate value is a positive number ---
    const numValue = Number(value);
    if (value == null || isNaN(numValue) || numValue < 0) {
      return Response.json(
        { success: false, error: "Value must be a positive number." },
        { status: 400 }
      );
    }

    // Coerce to integer for Int fields
    const dbValue = INT_FIELDS.has(field) ? Math.round(numValue) : numValue;

    // --- Build the update data ---
    // For lead_time_rules, also recompute the totalLeadTimeDays sum.
    const updateData: Record<string, number> = { [field]: dbValue };

    if (table === "lead_time_rules") {
      // Fetch current record so we can recompute the total
      const current = await db.leadTimeRule.findUnique({ where: { id } });
      if (!current) {
        return Response.json(
          { success: false, error: "Record not found." },
          { status: 404 }
        );
      }
      const merged = {
        poToProductionDays: current.poToProductionDays,
        productionDays: current.productionDays,
        transitDays: current.transitDays,
        portProcessingDays: current.portProcessingDays,
        [field]: dbValue,
      };
      updateData.totalLeadTimeDays =
        merged.poToProductionDays +
        merged.productionDays +
        merged.transitDays +
        merged.portProcessingDays;
    }

    // --- Perform the update ---
    switch (table) {
      case "sku_tier_rules":
        await db.skuTierRule.update({ where: { id }, data: updateData });
        break;
      case "safety_stock_rules":
        await db.safetyStockRule.update({ where: { id }, data: updateData });
        break;
      case "lead_time_rules":
        await db.leadTimeRule.update({ where: { id }, data: updateData });
        break;
      case "container_rules":
        await db.containerRule.update({ where: { id }, data: updateData });
        break;
      case "seasonality_factors":
        await db.seasonalityFactor.update({ where: { id }, data: updateData });
        break;
    }

    // For lead_time_rules, return the recomputed total so the UI can update it
    if (table === "lead_time_rules" && updateData.totalLeadTimeDays != null) {
      return Response.json({ success: true, totalLeadTimeDays: updateData.totalLeadTimeDays });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("Settings update failed:", err);
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "Update failed unexpectedly." },
      { status: 500 }
    );
  }
}
