// ============================================================================
// Drop-signal alerts
// ============================================================================
// Two purchasing-facing drop detectors:
//
//   1. Amazon forecast drop — compares each SKU's latest amazon_forecasts
//      snapshot to the prior distinct snapshot, summed over the near-term
//      window (default 8 weeks). A drop ≥ threshold% means Amazon is pulling
//      back demand on this SKU soon → consider delaying the next PO or
//      reducing quantity.
//
//   2. Sales velocity drop — compares each SKU's recent trailing sales
//      (default 4 weeks) to a longer baseline (default 13 weeks). If the
//      recent velocity is ≥ threshold% lower than baseline, demand is
//      softening → consider delaying or shrinking the next PO.
//
// Thresholds + window lengths are stored in system_settings and editable on
// the Settings page. Defaults are used if a setting key is missing.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";

export interface ForecastDropAlert {
  skuId: string;
  skuCode: string;
  skuName: string;
  currentSnapshotDate: Date;
  previousSnapshotDate: Date;
  currentWindowUnits: number;
  previousWindowUnits: number;
  dropUnits: number;
  dropPct: number;
  windowWeeks: number;
}

export interface VelocityDropAlert {
  skuId: string;
  skuCode: string;
  skuName: string;
  recentWeeklyUnits: number;
  baselineWeeklyUnits: number;
  dropPct: number;
  recentWindowWeeks: number;
  baselineWindowWeeks: number;
}

export interface DropAlertSettings {
  forecastDropPct: number;
  forecastWindowWeeks: number;
  velocityDropPct: number;
  velocityRecentWeeks: number;
  velocityBaselineWeeks: number;
}

const DEFAULTS: DropAlertSettings = {
  forecastDropPct: 15,
  forecastWindowWeeks: 8,
  velocityDropPct: 20,
  velocityRecentWeeks: 4,
  velocityBaselineWeeks: 13,
};

export async function loadDropAlertSettings(db: PrismaClient): Promise<DropAlertSettings> {
  const rows = await db.systemSetting.findMany({
    where: {
      key: {
        in: [
          "forecastDropAlertPct",
          "forecastDropWindowWeeks",
          "salesVelocityDropAlertPct",
          "salesVelocityDropRecentWeeks",
          "salesVelocityDropBaselineWeeks",
        ],
      },
    },
  });
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const safe = (key: string, fallback: number) => {
    const v = byKey.get(key);
    return v != null && Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    forecastDropPct: safe("forecastDropAlertPct", DEFAULTS.forecastDropPct),
    forecastWindowWeeks: safe("forecastDropWindowWeeks", DEFAULTS.forecastWindowWeeks),
    velocityDropPct: safe("salesVelocityDropAlertPct", DEFAULTS.velocityDropPct),
    velocityRecentWeeks: safe("salesVelocityDropRecentWeeks", DEFAULTS.velocityRecentWeeks),
    velocityBaselineWeeks: safe("salesVelocityDropBaselineWeeks", DEFAULTS.velocityBaselineWeeks),
  };
}

// ---------------------------------------------------------------------------
// Amazon forecast drop
// ---------------------------------------------------------------------------

// Per SKU: compare the latest snapshotDate to the previous distinct
// snapshotDate (at least 3 days older, so a same-day re-import doesn't
// become its own "previous"). Sum forecastUnits for weeks whose
// weekStartDate falls within [asOfDate, asOfDate + windowWeeks * 7).
// Flag if previous ≥ 10 units (noise guard) AND drop ≥ thresholdPct.
export async function calculateForecastDrops(
  db: PrismaClient,
  asOfDate: Date,
  settings: DropAlertSettings
): Promise<ForecastDropAlert[]> {
  const windowEnd = new Date(asOfDate);
  windowEnd.setDate(windowEnd.getDate() + settings.forecastWindowWeeks * 7);

  // Pull all forecasts that fall in the window; we'll group in memory.
  const rows = await db.amazonForecast.findMany({
    where: {
      weekStartDate: { gte: asOfDate, lt: windowEnd },
    },
    select: {
      skuId: true,
      snapshotDate: true,
      forecastUnits: true,
      sku: { select: { skuCode: true, name: true } },
    },
  });

  // Group by (skuId, snapshotDate) → summed forecast over the window
  const bySku = new Map<
    string,
    { skuCode: string; skuName: string; bySnapshot: Map<number, number> }
  >();

  for (const r of rows) {
    const ts = r.snapshotDate.getTime();
    let entry = bySku.get(r.skuId);
    if (!entry) {
      entry = { skuCode: r.sku.skuCode, skuName: r.sku.name, bySnapshot: new Map() };
      bySku.set(r.skuId, entry);
    }
    entry.bySnapshot.set(ts, (entry.bySnapshot.get(ts) ?? 0) + Number(r.forecastUnits));
  }

  const alerts: ForecastDropAlert[] = [];
  const minGapMs = 3 * 86400000; // require ≥3 days between snapshots

  for (const [skuId, { skuCode, skuName, bySnapshot }] of bySku) {
    const snapshots = [...bySnapshot.keys()].sort((a, b) => b - a);
    if (snapshots.length < 2) continue;

    const latestTs = snapshots[0];
    // Walk back until we find a snapshot at least minGapMs older
    const prevTs = snapshots.find((ts) => latestTs - ts >= minGapMs);
    if (prevTs == null) continue;

    const currentUnits = bySnapshot.get(latestTs) ?? 0;
    const previousUnits = bySnapshot.get(prevTs) ?? 0;
    if (previousUnits < 10) continue;

    const dropPct = ((previousUnits - currentUnits) / previousUnits) * 100;
    if (dropPct < settings.forecastDropPct) continue;

    alerts.push({
      skuId,
      skuCode,
      skuName,
      currentSnapshotDate: new Date(latestTs),
      previousSnapshotDate: new Date(prevTs),
      currentWindowUnits: Math.round(currentUnits),
      previousWindowUnits: Math.round(previousUnits),
      dropUnits: Math.round(previousUnits - currentUnits),
      dropPct,
      windowWeeks: settings.forecastWindowWeeks,
    });
  }

  alerts.sort((a, b) => b.dropPct - a.dropPct);
  return alerts;
}

// ---------------------------------------------------------------------------
// Sales velocity drop
// ---------------------------------------------------------------------------

// Compare trailing recentWeeks sales (units/week) vs trailing baselineWeeks
// (units/week) for each active SKU. Flag if recent is ≥ thresholdPct below
// baseline AND baseline weekly units ≥ 2 (noise guard — tiny velocities
// swing wildly in % terms).
export async function calculateSalesVelocityDrops(
  db: PrismaClient,
  asOfDate: Date,
  settings: DropAlertSettings
): Promise<VelocityDropAlert[]> {
  const recentStart = new Date(asOfDate);
  recentStart.setDate(recentStart.getDate() - settings.velocityRecentWeeks * 7);
  const baselineStart = new Date(asOfDate);
  baselineStart.setDate(baselineStart.getDate() - settings.velocityBaselineWeeks * 7);

  const records = await db.salesRecord.findMany({
    where: {
      periodEndDate: { gte: baselineStart },
      periodStartDate: { lte: asOfDate },
      sku: { status: "active", isKitParent: false },
    },
    select: {
      skuId: true,
      periodStartDate: true,
      periodEndDate: true,
      quantity: true,
      sku: { select: { skuCode: true, name: true } },
    },
  });

  // Accumulate pro-rated units into each SKU's recent + baseline buckets.
  const bySku = new Map<
    string,
    { skuCode: string; skuName: string; recent: number; baseline: number }
  >();

  const msPerDay = 86400000;
  for (const r of records) {
    const recordDays = Math.round((r.periodEndDate.getTime() - r.periodStartDate.getTime()) / msPerDay) + 1;
    if (recordDays <= 0) continue;

    // Baseline overlap
    const bStart = r.periodStartDate > baselineStart ? r.periodStartDate : baselineStart;
    const bEnd = r.periodEndDate < asOfDate ? r.periodEndDate : asOfDate;
    const bDays = Math.round((bEnd.getTime() - bStart.getTime()) / msPerDay) + 1;
    const baselineUnits = bDays > 0 ? (r.quantity * bDays) / recordDays : 0;

    // Recent overlap (subset of baseline window)
    const rStart = r.periodStartDate > recentStart ? r.periodStartDate : recentStart;
    const rEnd = r.periodEndDate < asOfDate ? r.periodEndDate : asOfDate;
    const rDays = Math.round((rEnd.getTime() - rStart.getTime()) / msPerDay) + 1;
    const recentUnits = rDays > 0 ? (r.quantity * rDays) / recordDays : 0;

    let entry = bySku.get(r.skuId);
    if (!entry) {
      entry = { skuCode: r.sku.skuCode, skuName: r.sku.name, recent: 0, baseline: 0 };
      bySku.set(r.skuId, entry);
    }
    entry.recent += recentUnits;
    entry.baseline += baselineUnits;
  }

  const alerts: VelocityDropAlert[] = [];
  for (const [skuId, { skuCode, skuName, recent, baseline }] of bySku) {
    const recentPerWeek = recent / settings.velocityRecentWeeks;
    const baselinePerWeek = baseline / settings.velocityBaselineWeeks;
    if (baselinePerWeek < 2) continue;

    const dropPct = ((baselinePerWeek - recentPerWeek) / baselinePerWeek) * 100;
    if (dropPct < settings.velocityDropPct) continue;

    alerts.push({
      skuId,
      skuCode,
      skuName,
      recentWeeklyUnits: recentPerWeek,
      baselineWeeklyUnits: baselinePerWeek,
      dropPct,
      recentWindowWeeks: settings.velocityRecentWeeks,
      baselineWindowWeeks: settings.velocityBaselineWeeks,
    });
  }

  alerts.sort((a, b) => b.dropPct - a.dropPct);
  return alerts;
}
