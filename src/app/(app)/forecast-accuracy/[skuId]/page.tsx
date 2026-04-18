import { prisma } from "@/lib/db";
import { Card, Badge } from "@/components/ui";
import Link from "next/link";
import { notFound } from "next/navigation";

// ============================================================================
// Forecast Accuracy — SKU Detail (week-by-week breakdown)
// ============================================================================

function AccuracyBadge({ pct }: { pct: number }) {
  if (pct >= 90 && pct <= 110) return <Badge variant="success">Accurate</Badge>;
  if (pct >= 75 && pct <= 125) return <Badge variant="warning">Fair</Badge>;
  return <Badge variant="error">Poor</Badge>;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1;
  return diff > 0 ? diff : 0;
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24) + 1;
}

export default async function ForecastAccuracyDetailPage({
  params,
}: {
  params: Promise<{ skuId: string }>;
}) {
  const { skuId } = await params;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sku = await prisma.sku.findUnique({
    where: { id: skuId },
    select: { id: true, skuCode: true, name: true, asin: true, tier: true },
  });

  if (!sku) notFound();

  // All forecast weeks for this SKU (past and future)
  const allForecasts = await prisma.amazonForecast.findMany({
    where: { skuId },
    select: {
      weekStartDate: true,
      weekEndDate: true,
      weekNumber: true,
      forecastUnits: true,
      snapshotDate: true,
    },
    orderBy: { weekStartDate: "asc" },
  });

  // Deduplicate — if multiple snapshots, keep the latest snapshot per week
  const forecastByWeek = new Map<string, typeof allForecasts[0]>();
  for (const f of allForecasts) {
    const key = f.weekStartDate.toISOString();
    const existing = forecastByWeek.get(key);
    if (!existing || f.snapshotDate > existing.snapshotDate) {
      forecastByWeek.set(key, f);
    }
  }

  const forecasts = [...forecastByWeek.values()].sort(
    (a, b) => a.weekStartDate.getTime() - b.weekStartDate.getTime(),
  );

  // Date range for sales
  const earliest = forecasts[0]?.weekStartDate;
  const latest = forecasts[forecasts.length - 1]?.weekEndDate;

  const salesRecords = earliest && latest
    ? await prisma.salesRecord.findMany({
        where: {
          skuId,
          channel: { in: ["amazon_1p", "amazon_di"] },
          periodEndDate: { gte: earliest },
          periodStartDate: { lte: latest },
        },
        select: {
          periodStartDate: true,
          periodEndDate: true,
          quantity: true,
          channel: true,
        },
      })
    : [];

  // Build week-by-week table
  const weeks = forecasts.map((f) => {
    const isPast = f.weekEndDate < today;
    const forecastUnits = Number(f.forecastUnits);

    let actual: number | null = null;
    if (isPast) {
      actual = 0;
      for (const sp of salesRecords) {
        const overlap = overlapDays(f.weekStartDate, f.weekEndDate, sp.periodStartDate, sp.periodEndDate);
        if (overlap > 0) {
          const periodLength = daysBetween(sp.periodStartDate, sp.periodEndDate);
          actual += sp.quantity * (overlap / periodLength);
        }
      }
      actual = Math.round(actual * 10) / 10;
    }

    const variance = actual !== null ? Math.round((actual - forecastUnits) * 10) / 10 : null;
    const accuracyPct = actual !== null && forecastUnits > 0
      ? Math.round((actual / forecastUnits) * 100)
      : null;

    return {
      weekNumber: f.weekNumber,
      weekStart: f.weekStartDate,
      weekEnd: f.weekEndDate,
      forecast: Math.round(forecastUnits * 10) / 10,
      actual,
      variance,
      accuracyPct,
      isPast,
    };
  });

  // Summary for past weeks only
  const pastWeeks = weeks.filter((w) => w.isPast);
  const totalForecast = pastWeeks.reduce((s, w) => s + w.forecast, 0);
  const totalActual = pastWeeks.reduce((s, w) => s + (w.actual ?? 0), 0);
  const overallAccuracy = totalForecast > 0 ? Math.round((totalActual / totalForecast) * 100) : null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/forecast-accuracy"
          className="text-sm text-[var(--c-accent)] hover:underline mb-2 inline-block"
        >
          &larr; Back to Forecast Accuracy
        </Link>
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">{sku.skuCode}</h1>
        <p className="text-sm text-[var(--c-text-secondary)] mt-1">
          {sku.name} &middot; ASIN: {sku.asin ?? "—"} &middot; Tier {sku.tier}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Past Weeks</p>
          <p className="text-2xl font-bold text-[var(--c-text-primary)] mt-1">{pastWeeks.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Total Forecast</p>
          <p className="text-2xl font-bold text-[var(--c-text-primary)] mt-1">{Math.round(totalForecast)}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Total Actual</p>
          <p className="text-2xl font-bold text-[var(--c-text-primary)] mt-1">{Math.round(totalActual)}</p>
        </Card>
        <Card>
          <p className="text-xs text-[var(--c-text-secondary)] font-medium uppercase">Overall Accuracy</p>
          <p className={`text-2xl font-bold mt-1 ${
            overallAccuracy !== null && overallAccuracy >= 90 && overallAccuracy <= 110
              ? "text-[var(--c-success)]"
              : overallAccuracy !== null && overallAccuracy >= 75 && overallAccuracy <= 125
              ? "text-[var(--c-warning)]"
              : "text-[var(--c-error)]"
          }`}>
            {overallAccuracy !== null ? `${overallAccuracy}%` : "—"}
          </p>
        </Card>
      </div>

      {/* Week-by-week table */}
      <Card title="Week-by-Week Breakdown" subtitle="Grey rows are future weeks (no actuals yet)">
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="px-6 py-2 font-medium">Week</th>
                <th className="px-4 py-2 font-medium">Date Range</th>
                <th className="px-4 py-2 font-medium text-right">Forecasted</th>
                <th className="px-4 py-2 font-medium text-right">Actual</th>
                <th className="px-4 py-2 font-medium text-right">Variance</th>
                <th className="px-4 py-2 font-medium text-center">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr
                  key={w.weekNumber}
                  className={`border-b border-[var(--c-border-row)] ${
                    w.isPast
                      ? "hover:bg-[var(--c-row-hover)]"
                      : "opacity-50"
                  }`}
                >
                  <td className="px-6 py-3 font-medium">Wk {w.weekNumber}</td>
                  <td className="px-4 py-3 text-[var(--c-text-secondary)]">
                    {formatDate(w.weekStart)} &ndash; {formatDate(w.weekEnd)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{w.forecast.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {w.actual !== null ? w.actual.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {w.variance !== null ? (
                      <span className={w.variance >= 0 ? "text-[var(--c-success)]" : "text-[var(--c-error)]"}>
                        {w.variance >= 0 ? "+" : ""}{w.variance.toFixed(1)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {w.accuracyPct !== null ? (
                      <AccuracyBadge pct={w.accuracyPct} />
                    ) : (
                      <span className="text-xs text-[var(--c-text-tertiary)]">Future</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
