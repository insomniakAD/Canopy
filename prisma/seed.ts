// ============================================================================
// CANOPY — Seed Script (Revised)
// ============================================================================
// Populates configuration tables with starting values.
// Run with: npx prisma db seed
//
// What this does:
//   1. Creates the 3 SKU tier rules (A=60, B=50, C=40 days)
//   2. Creates safety stock rules per tier
//   3. Creates lead time rules per country (China, Malaysia, Thailand)
//   4. Creates container rules (40GP, 40HQ)
//   5. Creates 12 monthly seasonality factors (all start at 1.0 — you fill in)
//   6. Creates 2 default inventory locations (Woodinville + Amazon 1P)
//   7. Creates an admin user for initial access
// ============================================================================

import { PrismaClient, SkuTier, Country, ContainerType, LocationType, UserRole } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding Canopy database...\n");

  // -------------------------------------------------------
  // 1. SKU Tier Rules
  // -------------------------------------------------------
  console.log("  Setting up SKU tier rules...");

  const tierRules = [
    {
      tier: SkuTier.A,
      targetDaysOfSupply: 60,
      amazonTargetDoi: 60,
      description: "Top 25% of SKUs by revenue. Keep 60 days of inventory. Amazon DOI target: 60.",
    },
    {
      tier: SkuTier.B,
      targetDaysOfSupply: 50,
      amazonTargetDoi: 50,
      description: "Top 50% of SKUs by revenue. Keep 50 days of inventory. Amazon DOI target: 50.",
    },
    {
      tier: SkuTier.C,
      targetDaysOfSupply: 40,
      amazonTargetDoi: 40,
      description: "Top 75% of SKUs by revenue. Keep 40 days of inventory. Amazon DOI target: 40.",
    },
    {
      tier: SkuTier.LP,
      targetDaysOfSupply: 30,
      amazonTargetDoi: 30,
      description: "Bottom 25% (Low Priority). Keep 30 days of inventory. Amazon DOI target: 30.",
    },
  ];

  for (const rule of tierRules) {
    await prisma.skuTierRule.upsert({
      where: { tier: rule.tier },
      update: rule,
      create: rule,
    });
  }
  console.log("  ✓ 4 tier rules created (A=60d, B=50d, C=40d, LP=30d)\n");

  // -------------------------------------------------------
  // 2. Safety Stock Rules
  // -------------------------------------------------------
  console.log("  Setting up safety stock rules...");

  const safetyRules = [
    {
      tier: SkuTier.A,
      safetyStockDays: 14,
      description: "Top tier: 2 weeks safety buffer on top of target.",
    },
    {
      tier: SkuTier.B,
      safetyStockDays: 10,
      description: "Mid tier: ~1.5 weeks safety buffer on top of target.",
    },
    {
      tier: SkuTier.C,
      safetyStockDays: 7,
      description: "Bottom tier: 1 week safety buffer on top of target.",
    },
    {
      tier: SkuTier.LP,
      safetyStockDays: 5,
      description: "Low Priority: minimal safety buffer.",
    },
  ];

  for (const rule of safetyRules) {
    await prisma.safetyStockRule.upsert({
      where: { tier: rule.tier },
      update: rule,
      create: rule,
    });
  }
  console.log("  ✓ 4 safety stock rules created (A=14d, B=10d, C=7d, LP=5d)\n");

  // -------------------------------------------------------
  // 3. Lead Time Rules
  // -------------------------------------------------------
  console.log("  Setting up lead time rules by country...");

  const leadTimeRules = [
    {
      country: Country.china,
      poToProductionDays: 20,
      productionDays: 35,
      transitDays: 25,
      portProcessingDays: 5,
      totalLeadTimeDays: 85,
    },
    {
      country: Country.malaysia,
      poToProductionDays: 20,
      productionDays: 30,
      transitDays: 22,
      portProcessingDays: 5,
      totalLeadTimeDays: 77,
    },
    {
      country: Country.thailand,
      poToProductionDays: 20,
      productionDays: 30,
      transitDays: 25,
      portProcessingDays: 5,
      totalLeadTimeDays: 80,
    },
  ];

  for (const rule of leadTimeRules) {
    await prisma.leadTimeRule.upsert({
      where: { country: rule.country },
      update: rule,
      create: rule,
    });
  }
  console.log("  ✓ 3 lead time rules created (China=85d, Malaysia=77d, Thailand=80d)\n");

  // -------------------------------------------------------
  // 4. Container Rules
  // -------------------------------------------------------
  console.log("  Setting up container rules...");

  const containerRules = [
    {
      containerType: ContainerType.forty_gp,
      maxCbm: 56,
      maxWeightKg: 26000,
      costEstimateUsd: 3500,
    },
    {
      containerType: ContainerType.forty_hq,
      maxCbm: 68,
      maxWeightKg: 26000,
      costEstimateUsd: 4000,
    },
  ];

  for (const rule of containerRules) {
    await prisma.containerRule.upsert({
      where: { containerType: rule.containerType },
      update: rule,
      create: rule,
    });
  }
  console.log("  ✓ 2 container rules created (40GP=56cbm, 40HQ=68cbm)\n");

  // -------------------------------------------------------
  // 5. Seasonality Factors
  // -------------------------------------------------------
  console.log("  Setting up seasonality factors (all 1.0 — fill in later)...");

  const monthNames = [
    "January", "February", "March", "April",
    "May", "June", "July", "August",
    "September", "October", "November", "December",
  ];

  for (let month = 1; month <= 12; month++) {
    await prisma.seasonalityFactor.upsert({
      where: { month },
      update: { factor: 1.0 },
      create: {
        month,
        factor: 1.0,
        description: `${monthNames[month - 1]} — adjust when you have seasonal data`,
      },
    });
  }
  console.log("  ✓ 12 monthly seasonality factors created (all set to 1.0)\n");

  // -------------------------------------------------------
  // 6. Default Inventory Locations
  // -------------------------------------------------------
  console.log("  Setting up inventory locations...");

  const locations = [
    {
      name: "Woodinville Warehouse",
      locationType: LocationType.domestic_warehouse,
    },
    {
      name: "Amazon 1P",
      locationType: LocationType.amazon_warehouse,
    },
  ];

  for (const loc of locations) {
    const existing = await prisma.inventoryLocation.findFirst({
      where: { name: loc.name },
    });
    if (!existing) {
      await prisma.inventoryLocation.create({ data: loc });
    }
  }
  console.log("  ✓ 2 inventory locations created (Woodinville + Amazon 1P)\n");

  // -------------------------------------------------------
  // 7. Admin User
  // -------------------------------------------------------
  console.log("  Setting up admin user...");

  const defaultPassword = "canopy2025";
  const passwordHash = await bcrypt.hash(defaultPassword, 12);

  await prisma.user.upsert({
    where: { email: "admin@winsome.com" },
    update: {},
    create: {
      email: "admin@winsome.com",
      name: "System Admin",
      role: UserRole.admin,
      passwordHash,
    },
  });
  console.log("  ✓ Admin user created (admin@winsome.com / canopy2025)\n");

  // -------------------------------------------------------
  // 8. System Settings (V2)
  // -------------------------------------------------------
  console.log("  Setting up V2 system settings...");

  const systemSettings = [
    {
      key: "forecastDropAlertPct",
      value: "15",
      label: "Forecast Drop Alert %",
      description: "Alert when Amazon forecast drops by this % compared to previous import.",
    },
    {
      key: "diHealthCadenceMultiplier",
      value: "1.5",
      label: "DI Cadence Alert Multiplier",
      description: "Flag DI health as 'red' when days since last order exceeds avg gap × this multiplier.",
    },
    {
      key: "channelShiftAlertPct",
      value: "20",
      label: "Channel Shift Alert %",
      description: "Alert when a channel's share of demand shifts by more than this % between runs.",
    },
    {
      key: "tierRecalcDayOfYear",
      value: "1",
      label: "Tier Recalculation Day",
      description: "Day of year (1-365) when annual tier recalculation is suggested.",
    },
  ];

  for (const setting of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value, label: setting.label, description: setting.description },
      create: setting,
    });
  }
  console.log("  ✓ 4 system settings created (V2 alert thresholds)\n");

  // -------------------------------------------------------
  // Done
  // -------------------------------------------------------
  console.log("🌿 Seed complete! Canopy database is ready.\n");
  console.log("Summary:");
  console.log("  • 4 SKU tier rules (A/B/C/LP)");
  console.log("  • 4 safety stock rules");
  console.log("  • 3 lead time rules (China/Malaysia/Thailand)");
  console.log("  • 2 container rules (40GP/40HQ)");
  console.log("  • 12 seasonality factors (all 1.0 — ready for your input)");
  console.log("  • 2 inventory locations (Woodinville Warehouse + Amazon 1P)");
  console.log("  • 1 admin user");
  console.log("  • 4 system settings (V2 alert thresholds)");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
