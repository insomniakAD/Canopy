import { db } from "@/lib/db";
import { Card, Badge, StatCard } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";

// ============================================================================
// In-Transit Pipeline
// ============================================================================
// Containers grouped by ETA. Each container shows the POs and SKUs riding in it,
// with the Receiving# (when applied at the warehouse) surfaced at the container
// level. Replaces the implicit container view that used to live inside the SKU
// detail page.
// ============================================================================

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtInt(n: number) {
  return n.toLocaleString("en-US");
}

function statusLabel(s: string) {
  return s.replace(/_/g, " ");
}

async function loadInTransit() {
  // All containers that aren't yet received or cancelled, plus any that were
  // received in the last 30 days (for "just-arrived" visibility).
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const containers = await db.container.findMany({
    where: {
      OR: [
        { status: { in: ["in_transit", "at_port"] } },
        { status: "received", actualArrivalDate: { gte: thirtyDaysAgo } },
      ],
    },
    include: {
      poLineItems: {
        include: {
          sku: { select: { skuCode: true, name: true } },
          purchaseOrder: {
            select: {
              poNumber: true,
              lotNumber: true,
              status: true,
              estimatedArrivalDate: true,
              factory: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ estimatedArrivalDate: "asc" }, { createdAt: "asc" }],
  });

  // Legacy POs whose lines have no container link yet — show them as a single
  // bucket so they're still visible during the migration window.
  const legacyLines = await db.poLineItem.findMany({
    where: {
      containerId: null,
      purchaseOrder: {
        status: { in: ["ordered", "in_production", "on_water", "at_port"] },
      },
    },
    include: {
      sku: { select: { skuCode: true, name: true } },
      purchaseOrder: {
        select: {
          poNumber: true,
          lotNumber: true,
          status: true,
          estimatedArrivalDate: true,
          factory: { select: { name: true } },
        },
      },
    },
    orderBy: [{ purchaseOrder: { estimatedArrivalDate: "asc" } }],
  });

  return { containers, legacyLines };
}

export default async function InTransitPage() {
  const { containers, legacyLines } = await loadInTransit();

  const totalContainers = containers.length;
  const totalUnits = containers.reduce(
    (sum, c) => sum + c.poLineItems.reduce((s, l) => s + (l.quantityOrdered - l.quantityReceived), 0),
    0,
  );
  const arrivingThisWeek = containers.filter((c) => {
    if (!c.estimatedArrivalDate || c.status === "received") return false;
    const days = (c.estimatedArrivalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days >= 0 && days <= 7;
  }).length;

  return (
    <div>
      <PageHeader title="In-Transit Pipeline" />
      <p className="text-sm text-[var(--c-text-secondary)] -mt-6 mb-6">
        Containers grouped by estimated arrival. Each container carries one or more POs.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Containers in Transit" value={totalContainers} accent="blue" />
        <StatCard label="Arriving This Week" value={arrivingThisWeek} accent={arrivingThisWeek > 0 ? "amber" : "default"} />
        <StatCard label="Open Inbound Units" value={fmtInt(totalUnits)} />
      </div>

      {containers.length === 0 && legacyLines.length === 0 && (
        <Card>
          <p className="text-sm text-[var(--c-text-tertiary)]">No containers in transit.</p>
        </Card>
      )}

      <div className="space-y-4">
        {containers.map((c) => {
          const totalQty = c.poLineItems.reduce((s, l) => s + (l.quantityOrdered - l.quantityReceived), 0);
          const factories = Array.from(
            new Set(c.poLineItems.map((l) => l.purchaseOrder.factory?.name).filter(Boolean) as string[]),
          );
          return (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[var(--c-text-primary)] font-mono">
                      Container {c.containerNumber}
                    </h3>
                    <Badge variant="neutral">{statusLabel(c.status)}</Badge>
                    {c.containerType && (
                      <Badge variant="neutral">
                        {c.containerType === "forty_gp" ? "40GP" : c.containerType === "forty_hq" ? "40HQ" : c.containerType}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-[var(--c-text-secondary)] mt-1">
                    {factories.length > 0 ? `From: ${factories.join(", ")}` : "Factory: —"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--c-text-tertiary)]">ETA</p>
                  <p className="text-sm font-semibold">{fmtDate(c.estimatedArrivalDate)}</p>
                  {c.actualArrivalDate && (
                    <p className="text-xs text-[var(--c-success)] mt-0.5">Arrived {fmtDate(c.actualArrivalDate)}</p>
                  )}
                  {c.receivingNumber && (
                    <p className="text-xs text-[var(--c-text-secondary)] mt-0.5 font-mono">RCVG# {c.receivingNumber}</p>
                  )}
                </div>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                    <th className="py-2 font-medium">PO #</th>
                    <th className="py-2 font-medium">Lot #</th>
                    <th className="py-2 font-medium">SKU</th>
                    <th className="py-2 font-medium text-right">Qty</th>
                    <th className="py-2 font-medium">Factory</th>
                  </tr>
                </thead>
                <tbody>
                  {c.poLineItems.map((l) => (
                    <tr key={l.id} className="border-b border-[var(--c-border-row)]">
                      <td className="py-2 font-medium">{l.purchaseOrder.poNumber}</td>
                      <td className="py-2 font-mono text-xs text-[var(--c-text-secondary)]">{l.purchaseOrder.lotNumber ?? "—"}</td>
                      <td className="py-2">
                        <Link href={`/skus/${l.skuId}`} className="text-[var(--c-accent)] hover:underline font-mono">
                          {l.sku.skuCode}
                        </Link>
                        <span className="text-xs text-[var(--c-text-tertiary)] ml-2">{l.sku.name}</span>
                      </td>
                      <td className="py-2 text-right font-mono">{fmtInt(l.quantityOrdered)}</td>
                      <td className="py-2 text-[var(--c-text-secondary)]">{l.purchaseOrder.factory?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-sm">
                    <td colSpan={3} className="py-2 text-right text-[var(--c-text-secondary)]">Container total</td>
                    <td className="py-2 text-right font-mono font-semibold">{fmtInt(totalQty)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          );
        })}

        {legacyLines.length > 0 && (
          <Card title="Open POs without container detail" subtitle={`${legacyLines.length} line(s) — container number not yet captured. Will populate on the next blob sync that includes them.`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="py-2 font-medium">PO #</th>
                  <th className="py-2 font-medium">Lot #</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">SKU</th>
                  <th className="py-2 font-medium text-right">Qty</th>
                  <th className="py-2 font-medium">Factory</th>
                  <th className="py-2 font-medium">PO ETA</th>
                </tr>
              </thead>
              <tbody>
                {legacyLines.map((l) => (
                  <tr key={l.id} className="border-b border-[var(--c-border-row)]">
                    <td className="py-2 font-medium">{l.purchaseOrder.poNumber}</td>
                    <td className="py-2 font-mono text-xs text-[var(--c-text-secondary)]">{l.purchaseOrder.lotNumber ?? "—"}</td>
                    <td className="py-2"><Badge variant="neutral">{statusLabel(l.purchaseOrder.status)}</Badge></td>
                    <td className="py-2">
                      <Link href={`/skus/${l.skuId}`} className="text-[var(--c-accent)] hover:underline font-mono">
                        {l.sku.skuCode}
                      </Link>
                    </td>
                    <td className="py-2 text-right font-mono">{fmtInt(l.quantityOrdered)}</td>
                    <td className="py-2 text-[var(--c-text-secondary)]">{l.purchaseOrder.factory?.name ?? "—"}</td>
                    <td className="py-2 text-[var(--c-text-secondary)]">{fmtDate(l.purchaseOrder.estimatedArrivalDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
