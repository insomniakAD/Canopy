import { db } from "@/lib/db";
import { Card, Badge, TierBadge, StatCard } from "@/components/ui";
import { CollapsibleSection } from "@/components/collapsible-section";
import Link from "next/link";
import { notFound } from "next/navigation";

// Helpers -----------------------------------------------------------------

function fmtNum(v: number | null | undefined, decimals = 1) {
  if (v == null) return "\u2014";
  return Number(v).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(v: number | null | undefined) {
  if (v == null) return "\u2014";
  return Number(v).toLocaleString();
}

function fmtDate(d: Date | string | null) {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtPct(v: number | null | undefined) {
  if (v == null) return "\u2014";
  const n = Number(v);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function poStatusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Data loader -------------------------------------------------------------

async function loadSkuDetail(skuId: string) {
  const sku = await db.sku.findUnique({
    where: { id: skuId },
    include: {
      defaultFactory: { select: { name: true, country: true, vendorCode: true } },
    },
  });

  if (!sku) return null;

  // Pending vendor transition (at most one per SKU in "pending" state)
  const pendingTransition = await db.pendingVendorTransition.findFirst({
    where: { skuId, status: "pending" },
    include: {
      toFactory: { select: { name: true, country: true, vendorCode: true } },
      fromFactory: { select: { name: true, country: true, vendorCode: true } },
    },
  });

  // Latest recommendation
  const rec = await db.reorderRecommendation.findFirst({
    where: { skuId, isCurrent: true },
    include: {
      recommendedFactory: { select: { name: true, country: true } },
    },
  });

  // Demand metrics
  const demandMetrics = await db.demandMetric.findMany({
    where: { skuId },
    orderBy: { periodWeeks: "asc" },
  });

  // Open POs for this SKU
  const poLines = await db.poLineItem.findMany({
    where: {
      skuId,
      purchaseOrder: {
        status: { in: ["ordered", "in_production", "on_water", "at_port"] },
      },
    },
    include: {
      purchaseOrder: {
        select: {
          poNumber: true,
          status: true,
          estimatedArrivalDate: true,
          factory: { select: { name: true } },
        },
      },
    },
  });

  // Latest inventory snapshots
  const snapshots = await db.inventorySnapshot.findMany({
    where: { skuId },
    orderBy: { snapshotDate: "desc" },
    take: 10,
    include: {
      location: { select: { name: true } },
    },
  });

  // Latest Amazon forecast
  const forecasts = await db.amazonForecast.findMany({
    where: { skuId },
    orderBy: [{ snapshotDate: "desc" }, { weekNumber: "asc" }],
    take: 12,
  });

  // Override history
  const overrides = await db.overrideLog.findMany({
    where: { skuId },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      user: { select: { name: true } },
    },
  });

  return { sku, rec, demandMetrics, poLines, snapshots, forecasts, overrides, pendingTransition };
}

// Page --------------------------------------------------------------------

export default async function SkuDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let data;
  try {
    data = await loadSkuDetail(id);
  } catch {
    return (
      <div>
        <Link href="/skus" className="text-sm text-[var(--c-accent)] hover:underline">&larr; Back to SKU Planning</Link>
        <div className="mt-6 bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-6 py-5">
          <p className="font-semibold text-[var(--c-warning-text)]">Database not connected</p>
        </div>
      </div>
    );
  }

  if (!data) notFound();

  const { sku, rec, demandMetrics, poLines, snapshots, forecasts, overrides, pendingTransition } = data;

  // Deduplicate snapshots to latest per location
  const latestSnapshots = new Map<string, typeof snapshots[0]>();
  for (const s of snapshots) {
    if (!latestSnapshots.has(s.locationId)) {
      latestSnapshots.set(s.locationId, s);
    }
  }

  return (
    <div>
      {/* Breadcrumb */}
      <Link href="/skus" className="text-sm text-[var(--c-accent)] hover:underline">&larr; Back to SKU Planning</Link>

      {/* Header */}
      <div className="mt-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">{sku.skuCode}</h1>
          <TierBadge tier={sku.tier} />
          {rec && <Badge variant={rec.decision as "order" | "watch" | "do_not_order"} />}
        </div>
        <p className="text-sm text-[var(--c-text-secondary)] mt-1">{sku.name}</p>
        {sku.asin && <p className="text-xs text-[var(--c-text-tertiary)] mt-0.5">ASIN: {sku.asin}</p>}
      </div>

      {/* Pending vendor transition banner + diff */}
      {pendingTransition && (
        <Card className="mb-6 border-[var(--c-warning-border)]">
          <div className="rounded-lg bg-[var(--c-warning-bg)] px-4 py-3 mb-4">
            <p className="text-sm font-semibold text-[var(--c-warning-text)]">
              Vendor transition pending
            </p>
            <p className="text-xs text-[var(--c-warning-text)] mt-0.5">
              The next PO on this SKU will use the new vendor. Current
              production values below stay in effect until that PO lands.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-[var(--c-border)] p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--c-text-secondary)] mb-2">
                Current
              </p>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">Vendor</dt>
                  <dd className="text-right">
                    {sku.defaultFactory
                      ? `${sku.defaultFactory.vendorCode ?? "—"} · ${sku.defaultFactory.name}`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">Country</dt>
                  <dd className="text-right">
                    {sku.defaultFactory?.country ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">Unit Cost</dt>
                  <dd className="text-right font-mono">
                    {sku.unitCostUsd != null ? `$${Number(sku.unitCostUsd).toFixed(2)}` : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">MOQ</dt>
                  <dd className="text-right font-mono">{fmtInt(sku.moq)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">FCL Qty 40GP</dt>
                  <dd className="text-right font-mono">{fmtInt(sku.fclQty40GP)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">FCL Qty 40HQ</dt>
                  <dd className="text-right font-mono">{fmtInt(sku.fclQty40HQ)}</dd>
                </div>
              </dl>
            </div>
            <div className="rounded-lg border border-[var(--c-warning-border)] bg-[var(--c-warning-bg-light)] p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--c-warning-text)] mb-2">
                Next (pending)
              </p>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">Vendor</dt>
                  <dd className="text-right">
                    {pendingTransition.toFactory
                      ? `${pendingTransition.toFactory.vendorCode ?? pendingTransition.newVendorCode} · ${pendingTransition.toFactory.name}`
                      : pendingTransition.newVendorCode}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">Country</dt>
                  <dd className="text-right">
                    {pendingTransition.toFactory?.country ?? "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">Unit Cost</dt>
                  <dd className="text-right font-mono">
                    {pendingTransition.newUnitCost != null
                      ? `$${Number(pendingTransition.newUnitCost).toFixed(2)}`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">MOQ</dt>
                  <dd className="text-right font-mono">
                    {fmtInt(pendingTransition.newMoq)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">FCL Qty 40GP</dt>
                  <dd className="text-right font-mono">
                    {fmtInt(pendingTransition.newFclQty40GP)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--c-text-secondary)]">FCL Qty 40HQ</dt>
                  <dd className="text-right font-mono">
                    {fmtInt(pendingTransition.newFclQty40HQ)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          {pendingTransition.reason && (
            <p className="text-xs text-[var(--c-text-secondary)] mt-3">
              Reason: {pendingTransition.reason}
            </p>
          )}
          {pendingTransition.expectedFirstPoDate && (
            <p className="text-xs text-[var(--c-text-secondary)] mt-1">
              Expected first PO: {fmtDate(pendingTransition.expectedFirstPoDate)}
            </p>
          )}
        </Card>
      )}

      {/* Summary row */}
      {rec && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard label="Weekly Demand" value={fmtNum(Number(rec.weeklyDemand))} sub="units/week" />
          <StatCard
            label="Weeks of Supply"
            value={fmtNum(Number(rec.weeksOfSupply))}
            sub={`Target: ${fmtNum(Number(rec.targetWeeksOfSupply))}w`}
            accent={Number(rec.weeksOfSupply) < 4 ? "red" : "default"}
          />
          <StatCard label="On Hand" value={fmtInt(rec.onHandInventory)} sub="total network" />
          <StatCard label="Inbound" value={fmtInt(rec.inboundInventory)} sub="open POs" />
          <StatCard
            label="Order Quantity"
            value={rec.adjustedQuantity > 0 ? fmtInt(rec.adjustedQuantity) : "\u2014"}
            accent="blue"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ───────── WHY THIS RECOMMENDATION ───────── */}
        {rec && (
          <Card title="Why This Recommendation" className="lg:col-span-2">
            {/* Decision Banner */}
            {rec.decision === "order" && (
              <div className="rounded-lg bg-[var(--c-success-bg)] px-4 py-3 mb-4">
                <p className="text-sm font-semibold text-[var(--c-success-text)]">
                  Order {fmtInt(rec.adjustedQuantity)} units
                  {rec.recommendedFactory ? ` from ${rec.recommendedFactory.name}` : ""}
                </p>
              </div>
            )}
            {rec.decision === "watch" && (
              <div className="rounded-lg bg-[var(--c-warning-bg)] px-4 py-3 mb-4">
                <p className="text-sm font-semibold text-[var(--c-warning-text)]">
                  Watch — no order needed right now
                </p>
              </div>
            )}
            {rec.decision === "do_not_order" && (
              <div className="rounded-lg bg-[var(--c-border-row)] px-4 py-3 mb-4">
                <p className="text-sm font-semibold text-[var(--c-text-secondary)]">
                  Do Not Order — sufficient stock
                </p>
              </div>
            )}

            {/* Key Factors */}
            <ul className="space-y-2 text-sm text-[var(--c-text-body)] mb-4">
              <li className="flex items-start gap-2">
                <span className="mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-[var(--c-text-tertiary)]" />
                <span>
                  Current supply:{" "}
                  <strong
                    className={
                      Number(rec.weeksOfSupply) < Number(rec.targetWeeksOfSupply)
                        ? "text-[var(--c-error)]"
                        : ""
                    }
                  >
                    {fmtNum(Number(rec.weeksOfSupply))} weeks
                  </strong>{" "}
                  (target: {fmtNum(Number(rec.targetWeeksOfSupply))} weeks)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-[var(--c-text-tertiary)]" />
                <span>
                  On hand: <strong>{fmtInt(rec.onHandInventory)} units</strong> + {fmtInt(rec.inboundInventory)} inbound
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-[var(--c-text-tertiary)]" />
                <span>
                  Weekly demand: <strong>{fmtNum(Number(rec.weeklyDemand))} units/week</strong>
                </span>
              </li>
              {rec.projectedStockoutDate && (
                <li className="flex items-start gap-2">
                  <span className="mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-[var(--c-error)]" />
                  <span className="text-[var(--c-error)] font-semibold">
                    Projected stockout: {fmtDate(rec.projectedStockoutDate)}
                  </span>
                </li>
              )}
              {rec.recommendedOrderByDate && (
                <li className="flex items-start gap-2">
                  <span className="mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-[var(--c-text-tertiary)]" />
                  <span>
                    Order by <strong>{fmtDate(rec.recommendedOrderByDate)}</strong> to avoid stockout
                  </span>
                </li>
              )}
              {rec.forecastVariancePct != null && (
                <li className="flex items-start gap-2">
                  <span
                    className={`mt-1 shrink-0 h-1.5 w-1.5 rounded-full ${
                      Math.abs(Number(rec.forecastVariancePct)) > 20
                        ? "bg-[var(--c-warning)]"
                        : "bg-[var(--c-text-tertiary)]"
                    }`}
                  />
                  <span
                    className={
                      Math.abs(Number(rec.forecastVariancePct)) > 20
                        ? "text-[var(--c-warning-text)]"
                        : ""
                    }
                  >
                    Amazon forecast variance: <strong>{fmtPct(Number(rec.forecastVariancePct))}</strong>
                  </span>
                </li>
              )}
            </ul>

            {pendingTransition && (
              <p className="text-sm italic text-[var(--c-text-secondary)] mb-4">
                Vendor transition pending. This recommended order uses the
                current vendor&apos;s MOQ, FCL quantities, and unit cost. The new
                vendor&apos;s terms take effect on the PO after this one.
              </p>
            )}

            {/* Full Analysis (collapsible) */}
            <div className="border-t border-[var(--c-border)] pt-4">
              <CollapsibleSection title="Show detailed analysis" defaultOpen={false}>
                <pre className="text-sm text-[var(--c-text-body)] whitespace-pre-wrap font-mono leading-relaxed bg-[var(--c-page-bg)] rounded-lg px-4 py-3 border border-[var(--c-border)]">
                  {rec.explanation}
                </pre>
              </CollapsibleSection>
            </div>
          </Card>
        )}

        {/* ───────── DEMAND ANALYSIS ───────── */}
        <Card title="Demand Analysis" subtitle="Weighted velocity over three lookback periods">
          {demandMetrics.length === 0 ? (
            <p className="text-sm text-[var(--c-text-tertiary)]">No demand calculations yet. Run the engine to see demand data.</p>
          ) : (
            <div>
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                    <th className="py-2 font-medium">Period</th>
                    <th className="py-2 font-medium text-right">Weekly Velocity</th>
                    <th className="py-2 font-medium text-right">Total Units</th>
                    <th className="py-2 font-medium text-right">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {demandMetrics.map((dm) => {
                    const weights: Record<number, string> = { 13: "50%", 26: "30%", 52: "20%" };
                    const labels: Record<number, string> = { 13: "3 Month", 26: "6 Month", 52: "12 Month" };
                    return (
                      <tr key={dm.id} className="border-b border-[var(--c-border-row)]">
                        <td className="py-2">{labels[dm.periodWeeks] ?? `${dm.periodWeeks}w`}</td>
                        <td className="py-2 text-right font-mono">{fmtNum(Number(dm.weeklyVelocity))}</td>
                        <td className="py-2 text-right font-mono">{fmtInt(dm.totalUnits)}</td>
                        <td className="py-2 text-right text-[var(--c-text-secondary)]">{weights[dm.periodWeeks] ?? "\u2014"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rec && (
                <div className="space-y-1 text-sm">
                  <p><span className="text-[var(--c-text-secondary)]">Blended weekly velocity:</span> <strong>{fmtNum(Number(rec.weeklyDemand))}</strong> units/week</p>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ───────── INVENTORY POSITION ───────── */}
        <Card title="Inventory Position" subtitle="Current stock levels across all locations">
          {latestSnapshots.size === 0 ? (
            <p className="text-sm text-[var(--c-text-tertiary)]">No inventory data. Import a WDS inventory file first.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="py-2 font-medium">Location</th>
                  <th className="py-2 font-medium text-right">On Hand</th>
                  <th className="py-2 font-medium text-right">Reserved</th>
                  <th className="py-2 font-medium text-right">Available</th>
                  <th className="py-2 font-medium">As Of</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(latestSnapshots.values()).map((s) => (
                  <tr key={s.id} className="border-b border-[var(--c-border-row)]">
                    <td className="py-2">{s.location.name}</td>
                    <td className="py-2 text-right font-mono">{fmtInt(s.quantityOnHand)}</td>
                    <td className="py-2 text-right font-mono">{fmtInt(s.quantityReserved)}</td>
                    <td className="py-2 text-right font-mono font-semibold">{fmtInt(s.quantityAvailable)}</td>
                    <td className="py-2 text-[var(--c-text-secondary)]">{fmtDate(s.snapshotDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* ───────── INBOUND SHIPMENTS ───────── */}
        <Card title="Inbound Shipments" subtitle="Open purchase orders for this SKU">
          {poLines.length === 0 ? (
            <p className="text-sm text-[var(--c-text-tertiary)]">No open purchase orders.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="py-2 font-medium">PO #</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Qty</th>
                  <th className="py-2 font-medium">Factory</th>
                  <th className="py-2 font-medium">ETA</th>
                </tr>
              </thead>
              <tbody>
                {poLines.map((pl) => (
                  <tr key={pl.id} className="border-b border-[var(--c-border-row)]">
                    <td className="py-2 font-medium">{pl.purchaseOrder.poNumber}</td>
                    <td className="py-2">
                      <Badge variant="neutral">{poStatusLabel(pl.purchaseOrder.status)}</Badge>
                    </td>
                    <td className="py-2 text-right font-mono">{fmtInt(pl.quantityOrdered)}</td>
                    <td className="py-2 text-[var(--c-text-secondary)]">{pl.purchaseOrder.factory?.name ?? "\u2014"}</td>
                    <td className="py-2 text-[var(--c-text-secondary)]">{fmtDate(pl.purchaseOrder.estimatedArrivalDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* ───────── AMAZON FORECAST COMPARISON ───────── */}
        <Card title="Amazon Forecast Comparison" subtitle="Amazon's demand forecast vs. Canopy's calculation">
          {rec?.amazonForecastWeekly == null ? (
            <p className="text-sm text-[var(--c-text-tertiary)]">No Amazon forecast data available for this SKU.</p>
          ) : (
            <div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <p className="text-xs text-[var(--c-text-secondary)]">Canopy Weekly</p>
                  <p className="text-lg font-bold">{fmtNum(Number(rec.weeklyDemand))}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-[var(--c-text-secondary)]">Amazon Weekly</p>
                  <p className="text-lg font-bold text-[var(--c-accent)]">{fmtNum(Number(rec.amazonForecastWeekly))}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-[var(--c-text-secondary)]">Variance</p>
                  <p className={`text-lg font-bold ${
                    Number(rec.forecastVariancePct) > 20 ? "text-[var(--c-warning)]" :
                    Number(rec.forecastVariancePct) < -20 ? "text-[var(--c-error)]" :
                    "text-[var(--c-success)]"
                  }`}>
                    {fmtPct(Number(rec.forecastVariancePct))}
                  </p>
                </div>
              </div>
              {Number(rec.amazonForecastOrderQty) > 0 && (
                <p className="text-sm text-[var(--c-text-secondary)]">
                  Amazon-based order quantity: <strong>{fmtInt(Number(rec.amazonForecastOrderQty))}</strong> units
                </p>
              )}
              {forecasts.length > 0 && (
                <div className="mt-4 border-t border-[var(--c-border)] pt-3">
                  <p className="text-xs font-medium text-[var(--c-text-secondary)] mb-2">Upcoming forecast weeks</p>
                  <div className="grid grid-cols-4 gap-2">
                    {forecasts.slice(0, 8).map((f) => (
                      <div key={f.id} className="text-center bg-[var(--c-page-bg)] rounded px-2 py-1.5">
                        <p className="text-xs text-[var(--c-text-tertiary)]">Wk {f.weekNumber}</p>
                        <p className="text-sm font-mono font-semibold">{fmtInt(Number(f.forecastUnits))}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ───────── TIMING & FACTORY ───────── */}
        {rec && (
          <Card title="Timing & Factory">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">Recommended Factory</span>
                <span className="font-medium">
                  {rec.recommendedFactory
                    ? `${rec.recommendedFactory.name} (${rec.recommendedFactory.country})`
                    : "No factory assigned"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">Default Factory</span>
                <span>
                  {sku.defaultFactory
                    ? `${sku.defaultFactory.name} (${sku.defaultFactory.country})`
                    : "None set"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">Order By Date</span>
                <span className={rec.recommendedOrderByDate ? "font-semibold" : ""}>
                  {fmtDate(rec.recommendedOrderByDate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">Projected Stockout</span>
                <span className={rec.projectedStockoutDate ? "text-[var(--c-error)] font-semibold" : ""}>
                  {fmtDate(rec.projectedStockoutDate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">Lead Time</span>
                <span>{rec.leadTimeDays} days</span>
              </div>
              {rec.fclFractionHQ != null && Number(rec.fclFractionHQ) > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--c-text-secondary)]">40HQ Load Fraction</span>
                  <span>~{fmtNum(Number(rec.fclFractionHQ), 2)}× 40HQ</span>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ───────── SKU DETAILS ───────── */}
        <Card title="SKU Details">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--c-text-secondary)]">SKU Code</span>
              <span className="font-medium">{sku.skuCode}</span>
            </div>
            {sku.asin && (
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">ASIN</span>
                <span className="font-mono">{sku.asin}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[var(--c-text-secondary)]">Category</span>
              <span>{sku.category ?? "\u2014"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--c-text-secondary)]">Status</span>
              <span className="capitalize">{sku.status}</span>
            </div>
            {sku.moq && (
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">MOQ</span>
                <span>{fmtInt(sku.moq)} units</span>
              </div>
            )}
            {sku.unitCostUsd && (
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">Unit Cost</span>
                <span>${Number(sku.unitCostUsd).toFixed(2)}</span>
              </div>
            )}
            {sku.fclQty40GP != null && (
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">FCL Qty (40GP)</span>
                <span>{fmtInt(sku.fclQty40GP)} units</span>
              </div>
            )}
            {sku.fclQty40HQ != null && (
              <div className="flex justify-between">
                <span className="text-[var(--c-text-secondary)]">FCL Qty (40HQ)</span>
                <span>{fmtInt(sku.fclQty40HQ)} units</span>
              </div>
            )}
          </div>
        </Card>

        {/* ───────── OVERRIDE HISTORY ───────── */}
        <Card title="Override History" subtitle="Manual adjustments made by buyers" className="lg:col-span-2">
          {overrides.length === 0 ? (
            <p className="text-sm text-[var(--c-text-tertiary)]">No overrides recorded for this SKU.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">User</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Original</th>
                  <th className="py-2 font-medium">Override</th>
                  <th className="py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id} className="border-b border-[var(--c-border-row)]">
                    <td className="py-2 text-[var(--c-text-secondary)]">{fmtDate(o.createdAt)}</td>
                    <td className="py-2">{o.user.name}</td>
                    <td className="py-2 capitalize">{o.overrideType}</td>
                    <td className="py-2 font-mono">{o.originalValue}</td>
                    <td className="py-2 font-mono font-semibold">{o.overrideValue}</td>
                    <td className="py-2 text-[var(--c-text-secondary)] max-w-[200px] truncate">{o.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
