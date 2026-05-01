import { db } from "@/lib/db";
import { Card, StatCard } from "@/components/ui";
import { Badge, TierBadge } from "@/components/ui";
import Link from "next/link";
import {
  calculateForecastDrops,
  calculateSalesVelocityDrops,
  loadDropAlertSettings,
} from "@/lib/engine/drop-alerts";
import { RunEngineButton } from "@/components/run-engine-button";
import { PageHeader } from "@/components/page-header";

// ---- Helpers ----------------------------------------------------------------

function fmtWos(v: number | null | undefined) {
  if (v == null) return "—";
  return `${Number(v).toFixed(1)}w`;
}

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function decisionVariant(d: string) {
  return d as "order" | "watch" | "do_not_order";
}

// ---- Alert banner chip ------------------------------------------------------

function AlertChip({
  count,
  label,
  sub,
  href,
  cta,
  accentColor,
}: {
  count: number;
  label: string;
  sub: string;
  href: string;
  cta: string;
  accentColor: string;
}) {
  return (
    <Link
      href={href}
      className="flex-1 flex items-center gap-4 px-5 py-3.5 bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] min-w-0 hover:bg-[var(--c-surface)] transition-colors"
      style={{ borderLeftWidth: "4px", borderLeftColor: accentColor }}
    >
      <span
        className="font-display text-2xl leading-none font-light shrink-0"
        style={{ color: accentColor }}
      >
        {count}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--c-text-primary)] leading-tight">{label}</p>
        <p className="text-xs text-[var(--c-text-tertiary)] truncate mt-0.5">{sub}</p>
      </div>
      <span className="text-xs font-medium text-[var(--c-accent)] whitespace-nowrap shrink-0">
        {cta}
      </span>
    </Link>
  );
}

// ---- Data loaders -----------------------------------------------------------

const REQUIRED_IMPORT_TYPES = [
  "wds_inventory",
  "wds_monthly_sales",
  "wds_monthly_cartons",
  "amazon_sales",
  "amazon_vendor_central",
  "amazon_forecast",
  "purchase_orders",
  "di_orders",
] as const;

async function loadMissingReports(): Promise<string[]> {
  try {
    const rows = await db.importBatch.groupBy({
      by: ["importType"],
      where: { status: "completed", importType: { in: [...REQUIRED_IMPORT_TYPES] } },
      _max: { createdAt: true },
    });
    const completed = new Set(rows.map((r) => r.importType));
    return REQUIRED_IMPORT_TYPES.filter((t) => !completed.has(t));
  } catch {
    return [];
  }
}

async function loadDashboard() {
  try {
    const recs = await db.reorderRecommendation.findMany({
      where: { isCurrent: true },
      include: { sku: { select: { skuCode: true, name: true, tier: true } } },
      orderBy: { weeksOfSupply: "asc" },
    });

    const orderRecs = recs.filter((r) => r.decision === "order");
    const watchRecs = recs.filter((r) => r.decision === "watch");
    const dnoRecs = recs.filter((r) => r.decision === "do_not_order");

    const criticalCount = orderRecs.filter((r) => Number(r.weeksOfSupply) < 4).length;
    const stockoutRisks = orderRecs.slice(0, 10);

    const totalUnits = orderRecs.reduce((s, r) => s + r.adjustedQuantity, 0);
    const totalFractionHQ = orderRecs.reduce(
      (s, r) => s + (r.fclFractionHQ ? Number(r.fclFractionHQ) : 0),
      0
    );

    const recentImports = await db.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const skuCount = await db.sku.count({ where: { status: "active" } });

    const doiAlerts = recs
      .filter((r) => r.amazonDoi != null && r.amazonTargetDoi != null)
      .filter((r) => Number(r.amazonDoi) < (r.amazonTargetDoi ?? 40) * 0.6)
      .sort((a, b) => Number(a.amazonDoi ?? 0) - Number(b.amazonDoi ?? 0))
      .slice(0, 5);

    const diAlerts = recs
      .filter((r) => r.diHealthStatus === "red" || r.diHealthStatus === "critical")
      .slice(0, 5);

    const forecastAlerts = recs
      .filter((r) => r.forecastVariancePct != null && Math.abs(Number(r.forecastVariancePct)) > 30)
      .sort((a, b) => Math.abs(Number(b.forecastVariancePct)) - Math.abs(Number(a.forecastVariancePct)))
      .slice(0, 5);

    const dropSettings = await loadDropAlertSettings(db);
    const asOf = new Date();
    const forecastDrops = (await calculateForecastDrops(db, asOf, dropSettings)).slice(0, 5);
    const velocityDrops = (await calculateSalesVelocityDrops(db, asOf, dropSettings)).slice(0, 5);

    return {
      ok: true as const,
      skuCount,
      orderCount: orderRecs.length,
      watchCount: watchRecs.length,
      dnoCount: dnoRecs.length,
      criticalCount,
      totalUnits,
      totalFractionHQ,
      stockoutRisks,
      recentImports,
      lastRunDate: recs[0]?.calculationDate ?? null,
      doiAlerts,
      diAlerts,
      forecastAlerts,
      forecastDrops,
      velocityDrops,
      dropSettings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Dashboard DB error:", message);
    return { ok: false as const, error: message };
  }
}

// ---- Page -------------------------------------------------------------------

export default async function DashboardPage() {
  const [data, missingReports] = await Promise.all([
    loadDashboard(),
    loadMissingReports(),
  ]);

  if (!data.ok) {
    return (
      <div className="bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-6 py-5">
        <p className="font-semibold text-[var(--c-warning-text)]">Database not connected</p>
        <p className="text-sm text-[var(--c-warning-text-alt)] mt-1">
          Set up PostgreSQL, run migrations, and seed the database to get started.
          See the project README for setup instructions.
        </p>
        {data.error && process.env.NODE_ENV !== "production" && (
          <p className="text-xs text-[var(--c-warning-text-alt)] mt-2 font-mono opacity-75">
            Error: {data.error}
          </p>
        )}
      </div>
    );
  }

  const {
    skuCount,
    orderCount,
    watchCount,
    dnoCount,
    criticalCount,
    totalUnits,
    totalFractionHQ,
    stockoutRisks,
    recentImports,
    lastRunDate,
    doiAlerts,
    diAlerts,
    forecastAlerts,
    forecastDrops,
    velocityDrops,
    dropSettings,
  } = data;

  const hasRecs = orderCount + watchCount + dnoCount > 0;
  const hasAlerts = criticalCount > 0 || doiAlerts.length > 0 || forecastDrops.length > 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={<RunEngineButton missingReports={missingReports} />}
      />

      <p className="text-sm text-[var(--c-text-tertiary)] mb-5">
        {lastRunDate
          ? `Last run: ${fmtDate(lastRunDate)}`
          : "No recommendations yet"}
      </p>

      {/* Alert banner strip */}
      {hasAlerts && (
        <div className="flex gap-3 mb-6 flex-wrap">
          {criticalCount > 0 && (
            <AlertChip
              count={criticalCount}
              label="Critical Stockouts"
              sub="< 4 weeks of supply at current velocity"
              href="/skus"
              cta={`View ${criticalCount} SKU${criticalCount !== 1 ? "s" : ""} →`}
              accentColor="var(--c-error)"
            />
          )}
          {doiAlerts.length > 0 && (
            <AlertChip
              count={doiAlerts.length}
              label="Low DOI Warning"
              sub="Amazon inventory within reorder window"
              href="/amazon-doi"
              cta="Review →"
              accentColor="var(--c-warning)"
            />
          )}
          {forecastDrops.length > 0 && (
            <AlertChip
              count={forecastDrops.length}
              label="Forecast Drop Detected"
              sub={`Amazon forecast ↓≥${dropSettings.forecastDropPct}% vs. prior snapshot`}
              href="#forecast-drops"
              cta="View Details →"
              accentColor="var(--c-accent)"
            />
          )}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active SKUs" value={skuCount} />
        <StatCard
          label="SKUs to Order"
          value={orderCount}
          accent="blue"
          sub={
            hasRecs
              ? `${totalUnits.toLocaleString()} units / ~${totalFractionHQ.toFixed(1)} × 40HQ`
              : undefined
          }
        />
        <StatCard label="Watch List" value={watchCount} accent="amber" />
        <StatCard label="Do Not Order" value={dnoCount} />
      </div>

      {/* Main content — 2-col when recs exist, single-col otherwise */}
      {hasRecs ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: action tables */}
          <div className="lg:col-span-2 space-y-6">
            {stockoutRisks.length > 0 && (
              <Card
                title="Highest Stockout Risk"
                subtitle="SKUs with the lowest weeks of supply that need ordering"
              >
                <div className="overflow-x-auto -mx-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                        <th className="px-6 py-3 font-medium">SKU</th>
                        <th className="px-6 py-3 font-medium">Tier</th>
                        <th className="px-6 py-3 font-medium text-right">Weeks of Supply</th>
                        <th className="px-6 py-3 font-medium text-right">On Hand</th>
                        <th className="px-6 py-3 font-medium text-right">Order Qty</th>
                        <th className="px-6 py-3 font-medium">Stockout Date</th>
                        <th className="px-6 py-3 font-medium">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockoutRisks.map((r) => (
                        <tr key={r.id} className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-page-bg)]">
                          <td className="px-6 py-3">
                            <Link href={`/skus/${r.skuId}`} className="text-[var(--c-accent)] font-medium hover:underline">
                              {r.sku.skuCode}
                            </Link>
                            <p className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[200px]">{r.sku.name}</p>
                          </td>
                          <td className="px-6 py-3"><TierBadge tier={r.sku.tier} /></td>
                          <td className="px-6 py-3 text-right font-mono">
                            <span className={Number(r.weeksOfSupply) < 4 ? "text-[var(--c-error)] font-semibold" : ""}>
                              {fmtWos(Number(r.weeksOfSupply))}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right font-mono">{r.onHandInventory.toLocaleString()}</td>
                          <td className="px-6 py-3 text-right font-mono font-semibold">{r.adjustedQuantity.toLocaleString()}</td>
                          <td className="px-6 py-3">{fmtDate(r.projectedStockoutDate)}</td>
                          <td className="px-6 py-3"><Badge variant={decisionVariant(r.decision)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {doiAlerts.length > 0 && (
              <Card
                title="Amazon DOI Alerts"
                subtitle="SKUs with low Amazon inventory — expect incoming 1P/DF orders"
              >
                <div className="space-y-2">
                  {doiAlerts.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-2.5 bg-[var(--c-error-bg-light)] rounded-lg">
                      <div className="flex items-center gap-3">
                        <Link href={`/skus/${r.skuId}`} className="font-semibold text-sm text-[var(--c-accent)] hover:underline">
                          {r.sku.skuCode}
                        </Link>
                        <span className="text-xs text-[var(--c-text-secondary)] truncate max-w-[200px]">{r.sku.name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="font-mono">
                          <span className="font-bold text-[var(--c-error)]">{Number(r.amazonDoi).toFixed(0)}d</span>
                          <span className="text-[var(--c-text-tertiary)]"> / {r.amazonTargetDoi}d target</span>
                        </span>
                        <Badge variant={Number(r.amazonDoi) <= 0 ? "error" : "warning"}>
                          {Number(r.amazonDoi) <= 0 ? "Out of Stock" : "Low DOI"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  <Link href="/amazon-doi" className="block text-xs text-[var(--c-accent)] hover:underline mt-2">
                    View all Amazon DOI &rarr;
                  </Link>
                </div>
              </Card>
            )}

            {diAlerts.length > 0 && (
              <Card
                title="DI Health Alerts"
                subtitle="Direct Import orders overdue — Woodinville may see increased 1P/DF volume"
              >
                <div className="space-y-2">
                  {diAlerts.map((r) => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-2.5 bg-[var(--c-warning-bg)] rounded-lg">
                      <div className="flex items-center gap-3">
                        <Link href={`/skus/${r.skuId}`} className="font-semibold text-sm text-[var(--c-accent)] hover:underline">
                          {r.sku.skuCode}
                        </Link>
                        <span className="text-xs text-[var(--c-text-secondary)] truncate max-w-[200px]">{r.sku.name}</span>
                      </div>
                      <Badge variant={r.diHealthStatus === "critical" ? "error" : "warning"}>
                        {r.diHealthStatus === "critical" ? "Critical" : "Alert"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {forecastAlerts.length > 0 && (
              <Card
                title="Forecast Variance Alerts"
                subtitle="SKUs where Amazon's forecast differs significantly from Canopy"
              >
                <div className="space-y-2">
                  {forecastAlerts.map((r) => {
                    const pct = Number(r.forecastVariancePct);
                    const direction = pct > 0 ? "higher" : "lower";
                    return (
                      <div key={r.id} className="flex items-center justify-between px-4 py-2.5 bg-[var(--c-info-bg-light)] rounded-lg">
                        <div className="flex items-center gap-3">
                          <Link href={`/skus/${r.skuId}`} className="font-semibold text-sm text-[var(--c-accent)] hover:underline">
                            {r.sku.skuCode}
                          </Link>
                          <span className="text-xs text-[var(--c-text-secondary)] truncate max-w-[200px]">{r.sku.name}</span>
                        </div>
                        <span className="text-sm font-mono">
                          Amazon is{" "}
                          <span className={pct > 0 ? "text-[var(--c-success)] font-bold" : "text-[var(--c-error)] font-bold"}>
                            {Math.abs(pct).toFixed(0)}% {direction}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {forecastDrops.length > 0 && (
              <div id="forecast-drops">
                <Card
                  title="Amazon Forecast Pull-Back"
                  subtitle={`Amazon cut its next-${dropSettings.forecastWindowWeeks}w forecast by ≥${dropSettings.forecastDropPct}% vs. the prior snapshot`}
                >
                  <div className="space-y-2">
                    {forecastDrops.map((d) => (
                      <div key={d.skuId} className="flex items-center justify-between px-4 py-2.5 bg-[var(--c-warning-bg)] rounded-lg">
                        <div className="flex items-center gap-3">
                          <Link href={`/skus/${d.skuId}`} className="font-semibold text-sm text-[var(--c-accent)] hover:underline">
                            {d.skuCode}
                          </Link>
                          <span className="text-xs text-[var(--c-text-secondary)] truncate max-w-[200px]">{d.skuName}</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="font-mono text-[var(--c-text-secondary)]">
                            {d.previousWindowUnits.toLocaleString()} &rarr; {d.currentWindowUnits.toLocaleString()} units
                          </span>
                          <Badge variant="warning">-{d.dropPct.toFixed(0)}%</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  <details className="mt-3 text-xs text-[var(--c-text-tertiary)]">
                    <summary className="cursor-pointer hover:text-[var(--c-text-secondary)]">How this is calculated, why it matters, what to do</summary>
                    <div className="mt-2 space-y-1.5 pl-4">
                      <p><strong>Calc:</strong> Sum Amazon&apos;s forecast units over the next {dropSettings.forecastWindowWeeks} weeks from the latest snapshot vs. the previous distinct snapshot (&ge;3 days older). Flag when the drop is &ge;{dropSettings.forecastDropPct}% and the prior sum was &ge;10 units.</p>
                      <p><strong>Why:</strong> A near-term cut is Amazon signaling reduced pull-through &mdash; often because DI already covers the gap, or their own demand forecast softened.</p>
                      <p><strong>Action:</strong> Consider delaying the next PO, shrinking quantity, or holding capacity for a different SKU. Validate against your own sales-velocity trend before reacting. Thresholds are editable in <Link href="/settings" className="text-[var(--c-accent)] hover:underline">Settings</Link>.</p>
                    </div>
                  </details>
                </Card>
              </div>
            )}

            {velocityDrops.length > 0 && (
              <Card
                title="Sales Velocity Drop"
                subtitle={`Recent ${dropSettings.velocityRecentWeeks}w weekly sales ≥${dropSettings.velocityDropPct}% below the ${dropSettings.velocityBaselineWeeks}w baseline`}
              >
                <div className="space-y-2">
                  {velocityDrops.map((d) => (
                    <div key={d.skuId} className="flex items-center justify-between px-4 py-2.5 bg-[var(--c-info-bg-light)] rounded-lg">
                      <div className="flex items-center gap-3">
                        <Link href={`/skus/${d.skuId}`} className="font-semibold text-sm text-[var(--c-accent)] hover:underline">
                          {d.skuCode}
                        </Link>
                        <span className="text-xs text-[var(--c-text-secondary)] truncate max-w-[200px]">{d.skuName}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-mono text-[var(--c-text-secondary)]">
                          {d.baselineWeeklyUnits.toFixed(1)} &rarr; {d.recentWeeklyUnits.toFixed(1)} units/wk
                        </span>
                        <Badge variant="warning">-{d.dropPct.toFixed(0)}%</Badge>
                      </div>
                    </div>
                  ))}
                </div>
                <details className="mt-3 text-xs text-[var(--c-text-tertiary)]">
                  <summary className="cursor-pointer hover:text-[var(--c-text-secondary)]">How this is calculated, why it matters, what to do</summary>
                  <div className="mt-2 space-y-1.5 pl-4">
                    <p><strong>Calc:</strong> Pro-rate each sales record that overlaps the trailing {dropSettings.velocityRecentWeeks}w and {dropSettings.velocityBaselineWeeks}w windows, then compare units/week. Flag when recent is &ge;{dropSettings.velocityDropPct}% below baseline and baseline is &ge;2 units/wk.</p>
                    <p><strong>Why:</strong> Independent of Amazon&apos;s forecast &mdash; this is what actually shipped. A drop here means demand is softening now, so the next reorder should carry less.</p>
                    <p><strong>Action:</strong> Reduce the next PO quantity or delay it. Check whether the drop is channel-specific (1P vs DI vs domestic) on the SKU detail. Thresholds are editable in <Link href="/settings" className="text-[var(--c-accent)] hover:underline">Settings</Link>.</p>
                  </div>
                </details>
              </Card>
            )}
          </div>

          {/* Right: recent imports */}
          <div className="space-y-6">
            <RecentImportsCard recentImports={recentImports} fmtDate={fmtDate} />
          </div>
        </div>
      ) : (
        /* No recs yet — two-up layout: imports + getting started */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RecentImportsCard recentImports={recentImports} fmtDate={fmtDate} />
          <Card title="Getting Started">
            <ol className="space-y-3 text-sm text-[var(--c-text-body)]">
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 bg-[var(--c-accent)] text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                <span><strong>Import inventory data</strong> &mdash; Upload your WDS inventory export to set current stock levels.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 bg-[var(--c-accent)] text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                <span><strong>Import sales history</strong> &mdash; Upload WDS monthly sales and Amazon Sales Diagnostic reports.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 bg-[var(--c-accent)] text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                <span><strong>Import purchase orders</strong> &mdash; Upload your open POs so the system knows what is in transit.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-none w-6 h-6 bg-[var(--c-accent)] text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
                <span><strong>Run recommendations</strong> &mdash; Click &ldquo;Run Recommendations&rdquo; above to see what to order.</span>
              </li>
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---- Sub-components ---------------------------------------------------------

function RecentImportsCard({
  recentImports,
  fmtDate,
}: {
  recentImports: Awaited<ReturnType<typeof loadRecentImports>>;
  fmtDate: (d: Date | string | null) => string;
}) {
  return (
    <Card title="Recent Imports" subtitle="Last 5 data imports">
      {recentImports.length === 0 ? (
        <p className="text-sm text-[var(--c-text-tertiary)] py-4">
          No imports yet.{" "}
          <Link href="/import" className="text-[var(--c-accent)] hover:underline">
            Upload your first file
          </Link>
        </p>
      ) : (
        <div>
          <div className="space-y-0">
            {recentImports.map((b) => {
              const typeLabel = b.importType
                .replace(/_/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
              const statusVariant: Record<string, "success" | "warning" | "error" | "neutral"> = {
                completed: "success",
                processing: "warning",
                failed: "error",
                pending: "neutral",
              };
              return (
                <div
                  key={b.id}
                  className="flex items-start justify-between gap-3 py-2.5 border-b border-[var(--c-border-row)] last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--c-text-primary)] truncate">{b.fileName}</p>
                    <p className="text-xs text-[var(--c-text-tertiary)] mt-0.5">
                      {typeLabel} &middot; {fmtDate(b.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <Badge variant={statusVariant[b.status] ?? "neutral"}>{b.status}</Badge>
                    <span className="text-xs text-[var(--c-text-tertiary)] font-mono">
                      {b.rowsImported}/{b.rowCount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <Link href="/import" className="block text-xs text-[var(--c-accent)] hover:underline mt-3">
            Go to Import Data &rarr;
          </Link>
        </div>
      )}
    </Card>
  );
}

async function loadRecentImports() {
  return db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
}
