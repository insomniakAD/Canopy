import { db } from "@/lib/db";
import { Card, StatCard } from "@/components/ui";
import { Badge, TierBadge } from "@/components/ui";
import Link from "next/link";

// Helpers -----------------------------------------------------------------

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

// Data loaders ------------------------------------------------------------

async function loadDashboard() {
  try {
    // Current recommendations
    const recs = await db.reorderRecommendation.findMany({
      where: { isCurrent: true },
      include: {
        sku: { select: { skuCode: true, name: true, tier: true } },
      },
      orderBy: { weeksOfSupply: "asc" },
    });

    const orderRecs = recs.filter((r) => r.decision === "order");
    const watchRecs = recs.filter((r) => r.decision === "watch");
    const dnoRecs = recs.filter((r) => r.decision === "do_not_order");

    // Stockout risks: order recs sorted by weeks of supply, top 10
    const stockoutRisks = orderRecs.slice(0, 10);

    // Total units and CBM to order
    const totalUnits = orderRecs.reduce((s, r) => s + r.adjustedQuantity, 0);
    const totalCbm = orderRecs.reduce(
      (s, r) => s + (r.containerCbmImpact ? Number(r.containerCbmImpact) : 0),
      0
    );

    // Recent imports
    const recentImports = await db.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    // Active SKU count
    const skuCount = await db.sku.count({ where: { status: "active" } });

    return {
      ok: true as const,
      skuCount,
      orderCount: orderRecs.length,
      watchCount: watchRecs.length,
      dnoCount: dnoRecs.length,
      totalUnits,
      totalCbm,
      stockoutRisks,
      recentImports,
      lastRunDate: recs[0]?.calculationDate ?? null,
    };
  } catch {
    return { ok: false as const };
  }
}

// Page --------------------------------------------------------------------

export default async function DashboardPage() {
  const data = await loadDashboard();

  if (!data.ok) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Dashboard</h1>
        <div className="mt-6 bg-[var(--c-warning-bg)] border border-[var(--c-warning-border)] rounded-xl px-6 py-5">
          <p className="font-semibold text-[var(--c-warning-text)]">Database not connected</p>
          <p className="text-sm text-[var(--c-warning-text-alt)] mt-1">
            Set up PostgreSQL, run migrations, and seed the database to get started.
            See the project README for setup instructions.
          </p>
        </div>
      </div>
    );
  }

  const {
    skuCount,
    orderCount,
    watchCount,
    dnoCount,
    totalUnits,
    totalCbm,
    stockoutRisks,
    recentImports,
    lastRunDate,
  } = data;

  const hasRecs = orderCount + watchCount + dnoCount > 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--c-text-primary)]">Dashboard</h1>
          <p className="text-sm text-[var(--c-text-secondary)] mt-1">
            {lastRunDate
              ? `Last recommendation run: ${fmtDate(lastRunDate)}`
              : "No recommendation runs yet"}
          </p>
        </div>
        {hasRecs && (
          <Link
            href="/skus"
            className="text-sm font-medium text-[var(--c-accent)] hover:underline"
          >
            View all SKU recommendations &rarr;
          </Link>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active SKUs" value={skuCount} accent="default" />
        <StatCard
          label="SKUs to Order"
          value={orderCount}
          accent="blue"
          sub={hasRecs ? `${totalUnits.toLocaleString()} units / ${totalCbm.toFixed(1)} CBM` : undefined}
        />
        <StatCard label="Watch List" value={watchCount} accent="amber" />
        <StatCard label="Do Not Order" value={dnoCount} accent="default" />
      </div>

      {/* Stockout risk table */}
      {stockoutRisks.length > 0 && (
        <Card
          title="Highest Stockout Risk"
          subtitle="SKUs with the lowest weeks of supply that need ordering"
          className="mb-8"
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
                    <td className="px-6 py-3">
                      <TierBadge tier={r.sku.tier} />
                    </td>
                    <td className="px-6 py-3 text-right font-mono">
                      <span className={Number(r.weeksOfSupply) < 4 ? "text-[var(--c-error)] font-semibold" : ""}>
                        {fmtWos(Number(r.weeksOfSupply))}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono">{r.onHandInventory.toLocaleString()}</td>
                    <td className="px-6 py-3 text-right font-mono font-semibold">
                      {r.adjustedQuantity.toLocaleString()}
                    </td>
                    <td className="px-6 py-3">{fmtDate(r.projectedStockoutDate)}</td>
                    <td className="px-6 py-3">
                      <Badge variant={decisionVariant(r.decision)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Recent imports */}
      <Card
        title="Recent Imports"
        subtitle="Last 5 data imports"
      >
        {recentImports.length === 0 ? (
          <p className="text-sm text-[var(--c-text-tertiary)] py-4">
            No imports yet.{" "}
            <Link href="/import" className="text-[var(--c-accent)] hover:underline">
              Upload your first file
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="px-6 py-3 font-medium">File</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Rows</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
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
                    <tr key={b.id} className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-page-bg)]">
                      <td className="px-6 py-3 font-medium truncate max-w-[200px]">{b.fileName}</td>
                      <td className="px-6 py-3 text-[var(--c-text-secondary)]">{typeLabel}</td>
                      <td className="px-6 py-3">
                        <Badge variant={statusVariant[b.status] ?? "neutral"}>{b.status}</Badge>
                      </td>
                      <td className="px-6 py-3 text-right font-mono">
                        {b.rowsImported}/{b.rowCount}
                      </td>
                      <td className="px-6 py-3 text-[var(--c-text-secondary)]">
                        {fmtDate(b.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Getting started guidance */}
      {!hasRecs && (
        <Card title="Getting Started" className="mt-8">
          <ol className="space-y-3 text-sm text-[var(--c-text-body)]">
            <li className="flex gap-3">
              <span className="flex-none w-6 h-6 bg-[var(--c-accent)] text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
              <span><strong>Import inventory data</strong> — Upload your WDS inventory export to set current stock levels.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-none w-6 h-6 bg-[var(--c-accent)] text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
              <span><strong>Import sales history</strong> — Upload WDS monthly sales and Amazon Sales Diagnostic reports.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-none w-6 h-6 bg-[var(--c-accent)] text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
              <span><strong>Import purchase orders</strong> — Upload your open POs so the system knows what is already in transit.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-none w-6 h-6 bg-[var(--c-accent)] text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
              <span><strong>Run recommendations</strong> — Head to <Link href="/skus" className="text-[var(--c-accent)] hover:underline">SKU Planning</Link> and click "Run Recommendations" to see what to order.</span>
            </li>
          </ol>
        </Card>
      )}
    </div>
  );
}
