import { prisma } from "@/lib/db";
import { Card, Badge } from "@/components/ui";
import Link from "next/link";

// ============================================================================
// Forecast Accuracy Report
// ============================================================================
// Compares Amazon's forecasted units against actual sales (1P + DI) for
// weeks that have already passed. Shows per-SKU accuracy, bias, and trend.
// ============================================================================

interface ForecastWeek {
  skuId: string;
  weekStart: Date;
  weekEnd: Date;
  forecastUnits: number;
}

interface SalesPeriod {
  skuId: string;
  periodStart: Date;
  periodEnd: Date;
  quantity: number;
}

interface SkuAccuracy {
  skuId: string;
  skuCode: string;
  name: string;
  asin: string;
  tier: string;
  weeksEvaluated: number;
  totalForecast: number;
  totalActual: number;
  avgForecast: number;
  avgActual: number;
  avgVariance: number;
  accuracyPct: number;
  bias: "over" | "under" | "accurate";
  weekDetails: WeekDetail[];
}

interface WeekDetail {
  weekStart: Date;
  weekEnd: Date;
  forecast: number;
  actual: number;
  variance: number;
  accuracyPct: number;
}

/**
 * Calculate the number of overlapping days between two date ranges.
 * Used to pro-rate monthly sales data into weekly forecast buckets.
 */
function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1;
  return diff > 0 ? diff : 0;
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24) + 1;
}

function AccuracyBadge({ pct }: { pct: number }) {
  if (pct >= 90 && pct <= 110) return <Badge variant="success">Accurate</Badge>;
  if (pct >= 75 && pct <= 125) return <Badge variant="warning">Fair</Badge>;
  return <Badge variant="error">Poor</Badge>;
}

function BiasBadge({ bias }: { bias: "over" | "under" | "accurate" }) {
  if (bias === "accurate") return <Badge variant="success">Balanced</Badge>;
  if (bias === "over") return <Badge variant="info">Over-forecasts</Badge>;
  return <Badge variant="warning">Under-forecasts</Badge>;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function ForecastAccuracyPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Load all forecast weeks that have already ended
  const pastForecasts = await prisma.amazonForecast.findMany({
    where: {
      weekEndDate: { lt: today },
    },
    select: {
      skuId: true,
      weekStartDate: true,
      weekEndDate: true,
      forecastUnits: true,
    },
    orderBy: { weekStartDate: "asc" },
  });

  if (pastForecasts.length === 0) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Forecast Accuracy</h1>
          <p className="text-sm text-[var(--c-text-secondary)] mt-1">
            Compare Amazon&apos;s forecasted demand against actual sales once forecast periods have passed.
          </p>
        </div>
        <Card>
          <div className="text-center py-12">
            <p className="text-sm text-[var(--c-text-secondary)]">
              No past forecast data available yet. Upload Amazon Forecast files from Vendor Central,
              then check back after the forecasted weeks have passed.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // Get all relevant SKU IDs
  const skuIds = [...new Set(pastForecasts.map((f) => f.skuId))];

  // Load SKU details
  const skus = await prisma.sku.findMany({
    where: { id: { in: skuIds } },
    select: { id: true, skuCode: true, name: true, asin: true, tier: true },
  });
  const skuMap = new Map(skus.map((s) => [s.id, s]));

  // Find the date range we need sales for
  const earliestWeekStart = pastForecasts.reduce(
    (min, f) => (f.weekStartDate < min ? f.weekStartDate : min),
    pastForecasts[0].weekStartDate,
  );
  const latestWeekEnd = pastForecasts.reduce(
    (max, f) => (f.weekEndDate > max ? f.weekEndDate : max),
    pastForecasts[0].weekEndDate,
  );

  // Load actual sales for those SKUs in that date range (1P + DI channels)
  const salesRecords = await prisma.salesRecord.findMany({
    where: {
      skuId: { in: skuIds },
      channel: { in: ["amazon_1p", "amazon_di"] },
      periodEndDate: { gte: earliestWeekStart },
      periodStartDate: { lte: latestWeekEnd },
    },
    select: {
      skuId: true,
      periodStartDate: true,
      periodEndDate: true,
      quantity: true,
    },
  });

  // Group data by SKU
  const forecastsBySku = new Map<string, ForecastWeek[]>();
  for (const f of pastForecasts) {
    const list = forecastsBySku.get(f.skuId) ?? [];
    list.push({
      skuId: f.skuId,
      weekStart: f.weekStartDate,
      weekEnd: f.weekEndDate,
      forecastUnits: Number(f.forecastUnits),
    });
    forecastsBySku.set(f.skuId, list);
  }

  const salesBySku = new Map<string, SalesPeriod[]>();
  for (const s of salesRecords) {
    const list = salesBySku.get(s.skuId) ?? [];
    list.push({
      skuId: s.skuId,
      periodStart: s.periodStartDate,
      periodEnd: s.periodEndDate,
      quantity: s.quantity,
    });
    salesBySku.set(s.skuId, list);
  }

  // Calculate accuracy per SKU
  const skuAccuracies: SkuAccuracy[] = [];

  for (const skuId of skuIds) {
    const sku = skuMap.get(skuId);
    if (!sku) continue;

    const forecasts = forecastsBySku.get(skuId) ?? [];
    const sales = salesBySku.get(skuId) ?? [];
    const weekDetails: WeekDetail[] = [];

    let totalForecast = 0;
    let totalActual = 0;

    for (const fw of forecasts) {
      // Pro-rate sales into this forecast week
      let weekActual = 0;
      for (const sp of sales) {
        const overlap = overlapDays(fw.weekStart, fw.weekEnd, sp.periodStart, sp.periodEnd);
        if (overlap > 0) {
          const periodLength = daysBetween(sp.periodStart, sp.periodEnd);
          weekActual += sp.quantity * (overlap / periodLength);
        }
      }

      weekActual = Math.round(weekActual * 10) / 10;
      const variance = weekActual - fw.forecastUnits;
      const accPct = fw.forecastUnits > 0 ? (weekActual / fw.forecastUnits) * 100 : 0;

      weekDetails.push({
        weekStart: fw.weekStart,
        weekEnd: fw.weekEnd,
        forecast: Math.round(fw.forecastUnits * 10) / 10,
        actual: weekActual,
        variance: Math.round(variance * 10) / 10,
        accuracyPct: Math.round(accPct),
      });

      totalForecast += fw.forecastUnits;
      totalActual += weekActual;
    }

    const weeksEvaluated = weekDetails.length;
    if (weeksEvaluated === 0) continue;

    const avgForecast = totalForecast / weeksEvaluated;
    const avgActual = totalActual / weeksEvaluated;
    const avgVariance = avgActual - avgForecast;
    const accuracyPct = totalForecast > 0 ? (totalActual / totalForecast) * 100 : 0;

    let bias: "over" | "under" | "accurate" = "accurate";
    if (accuracyPct < 90) bias = "over";    // Amazon predicted more than sold
    if (accuracyPct > 110) bias = "under";  // Amazon predicted less than sold

    skuAccuracies.push({
      skuId,
      skuCode: sku.skuCode,
      name: sku.name,
      asin: sku.asin ?? "—",
      tier: sku.tier,
      weeksEvaluated,
      totalForecast: Math.round(totalForecast),
      totalActual: Math.round(totalActual),
      avgForecast: Math.round(avgForecast * 10) / 10,
      avgActual: Math.round(avgActual * 10) / 10,
      avgVariance: Math.round(avgVariance * 10) / 10,
      accuracyPct: Math.round(accuracyPct),
      bias,
      weekDetails,
    });
  }

  // Sort: poorest accuracy first
  skuAccuracies.sort((a, b) => Math.abs(100 - a.accuracyPct) - Math.abs(100 - b.accuracyPct));
  skuAccuracies.reverse(); // Worst accuracy at top

  // Summary stats
  const totalSkusEvaluated = skuAccuracies.length;
  const totalWeeks = skuAccuracies.reduce((s, a) => s + a.weeksEvaluated, 0);
  const overallAccuracy = totalSkusEvaluated > 0
    ? Math.round(skuAccuracies.reduce((s, a) => s + a.accuracyPct, 0) / totalSkusEvaluated)
    : 0;
  const overForecastCount = skuAccuracies.filter((a) => a.bias === "over").length;
  const underForecastCount = skuAccuracies.filter((a) => a.bias === "under").length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Forecast Accuracy</h1>
        <p className="text-sm text-[var(--c-text-secondary)] mt-1">
          Comparing Amazon&apos;s forecasted demand vs. actual sales (1P + DI) for past weeks.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">SKUs Evaluated</p>
          <p className="text-2xl font-bold text-[var(--c-text-primary)] mt-1">{totalSkusEvaluated}</p>
          <p className="text-xs text-[var(--c-text-tertiary)] mt-0.5">{totalWeeks} ASIN-weeks</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Overall Accuracy</p>
          <p className={`text-2xl font-bold mt-1 ${
            overallAccuracy >= 90 && overallAccuracy <= 110
              ? "text-[var(--c-success)]"
              : overallAccuracy >= 75 && overallAccuracy <= 125
              ? "text-[var(--c-warning)]"
              : "text-[var(--c-error)]"
          }`}>
            {overallAccuracy}%
          </p>
          <p className="text-xs text-[var(--c-text-tertiary)] mt-0.5">100% = perfect</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Over-forecasts</p>
          <p className="text-2xl font-bold text-[var(--c-info)] mt-1">{overForecastCount}</p>
          <p className="text-xs text-[var(--c-text-tertiary)] mt-0.5">Amazon predicts too high</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Under-forecasts</p>
          <p className="text-2xl font-bold text-[var(--c-warning)] mt-1">{underForecastCount}</p>
          <p className="text-xs text-[var(--c-text-tertiary)] mt-0.5">Amazon predicts too low</p>
        </Card>
      </div>

      {/* Per-SKU accuracy table */}
      <Card title="Accuracy by SKU" subtitle="Worst accuracy shown first — click a SKU to see week-by-week breakdown">
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="px-6 py-2 font-medium">SKU</th>
                <th className="px-4 py-2 font-medium">ASIN</th>
                <th className="px-4 py-2 font-medium text-center">Tier</th>
                <th className="px-4 py-2 font-medium text-right">Weeks</th>
                <th className="px-4 py-2 font-medium text-right">Avg Forecast</th>
                <th className="px-4 py-2 font-medium text-right">Avg Actual</th>
                <th className="px-4 py-2 font-medium text-right">Avg Variance</th>
                <th className="px-4 py-2 font-medium text-center">Accuracy</th>
                <th className="px-4 py-2 font-medium text-center">Bias</th>
              </tr>
            </thead>
            <tbody>
              {skuAccuracies.map((sa) => (
                <tr key={sa.skuId} className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-row-hover)]">
                  <td className="px-6 py-3">
                    <Link
                      href={`/forecast-accuracy/${sa.skuId}`}
                      className="font-semibold text-[var(--c-accent)] hover:underline"
                    >
                      {sa.skuCode}
                    </Link>
                    <p className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[200px]">{sa.name}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--c-text-secondary)]">
                    {sa.asin}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="neutral">Tier {sa.tier}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{sa.weeksEvaluated}</td>
                  <td className="px-4 py-3 text-right font-mono">{sa.avgForecast.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{sa.avgActual.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span className={sa.avgVariance >= 0 ? "text-[var(--c-success)]" : "text-[var(--c-error)]"}>
                      {sa.avgVariance >= 0 ? "+" : ""}{sa.avgVariance.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <AccuracyBadge pct={sa.accuracyPct} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <BiasBadge bias={sa.bias} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Context box */}
      <div className="mt-6 bg-[var(--c-page-bg)] border border-[var(--c-border)] rounded-xl px-6 py-4">
        <p className="text-sm text-[var(--c-text-secondary)]">
          <strong className="text-[var(--c-text-body)]">How to read this:</strong>{" "}
          Accuracy = Actual / Forecast x 100. A value of 100% means Amazon&apos;s prediction was perfect.
          Below 90% = Amazon over-forecasted (predicted more than sold).
          Above 110% = Amazon under-forecasted (predicted less than sold).
          Sales data includes both 1P and DI channels, matching Amazon&apos;s retail forecast scope.
        </p>
      </div>
    </div>
  );
}
