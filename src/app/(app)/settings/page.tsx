import { db } from "@/lib/db";
import { Card } from "@/components/ui";
import { SettingsEditor } from "./settings-editor";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function loadSettings() {
  try {
    const [tierRules, safetyRules, leadTimeRules, containerRules, seasonality, systemSettings] = await Promise.all([
      db.skuTierRule.findMany({ orderBy: { tier: "asc" } }),
      db.safetyStockRule.findMany({ orderBy: { tier: "asc" } }),
      db.leadTimeRule.findMany({ orderBy: { country: "asc" } }),
      db.containerRule.findMany({ orderBy: { containerType: "asc" } }),
      db.seasonalityFactor.findMany({ orderBy: { month: "asc" } }),
      db.systemSetting.findMany({ orderBy: { key: "asc" } }),
    ]);

    return {
      ok: true as const,
      tierRules: tierRules.map((r) => ({
        id: r.id,
        tier: r.tier,
        targetDaysOfSupply: r.targetDaysOfSupply,
        amazonTargetDoi: r.amazonTargetDoi,
        description: r.description,
      })),
      safetyRules: safetyRules.map((r) => ({
        id: r.id,
        tier: r.tier,
        safetyStockDays: r.safetyStockDays,
        description: r.description,
      })),
      leadTimeRules: leadTimeRules.map((r) => ({
        id: r.id,
        country: r.country,
        poToProductionDays: r.poToProductionDays,
        productionDays: r.productionDays,
        transitDays: r.transitDays,
        portProcessingDays: r.portProcessingDays,
        totalLeadTimeDays: r.totalLeadTimeDays,
      })),
      containerRules: containerRules.map((r) => ({
        id: r.id,
        containerType: r.containerType,
        maxCbm: Number(r.maxCbm),
        maxWeightKg: Number(r.maxWeightKg),
        costEstimateUsd: r.costEstimateUsd ? Number(r.costEstimateUsd) : null,
      })),
      seasonality: seasonality.map((s) => ({
        id: s.id,
        month: s.month,
        monthName: MONTH_NAMES[s.month - 1] ?? `Month ${s.month}`,
        factor: Number(s.factor),
      })),
      systemSettings: systemSettings.map((s) => ({
        id: s.id,
        key: s.key,
        value: s.value,
        label: s.label,
        description: s.description,
      })),
    };
  } catch {
    return { ok: false as const };
  }
}

export default async function SettingsPage() {
  const data = await loadSettings();

  if (!data.ok) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Settings</h1>
        <div className="mt-6 bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-6 py-5">
          <p className="font-semibold text-[var(--c-warning-text)]">Database not connected</p>
          <p className="text-sm text-[var(--c-warning-text-alt)] mt-1">
            Configuration tables will be available after database setup.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--c-text-primary)] mb-1">Settings</h1>
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        Configuration tables that control how Canopy calculates recommendations. Changes here affect the next recommendation run.
      </p>

      <SettingsEditor
        tierRules={data.tierRules}
        safetyRules={data.safetyRules}
        leadTimeRules={data.leadTimeRules}
        containerRules={data.containerRules}
        seasonality={data.seasonality}
        systemSettings={data.systemSettings}
      />
    </div>
  );
}
