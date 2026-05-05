import { db } from "@/lib/db";
import { Card, Badge, StatCard } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { notFound } from "next/navigation";

// ============================================================================
// PO Detail Page
// ============================================================================
// Purchasing-context view of a Purchase Order. Shows the PO header (number,
// Lot#, factory, status), key dates, line items with their containers, and a
// container summary. Read-only — Importing-side detail (received PO browsing,
// container-number lookup) lives in the separate Importing system.
// ============================================================================

function fmtInt(v: number | null | undefined) {
  if (v == null) return "—";
  return Number(v).toLocaleString();
}

function fmtUsd(v: number | string | null | undefined) {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusVariant(s: string): "success" | "warning" | "error" | "neutral" {
  switch (s) {
    case "received":
      return "success";
    case "cancelled":
      return "error";
    case "ordered":
    case "in_production":
    case "on_water":
    case "at_port":
    case "in_transit":
      return "warning";
    default:
      return "neutral";
  }
}

function containerTypeLabel(t: string | null | undefined) {
  if (!t) return null;
  if (t === "forty_gp") return "40GP";
  if (t === "forty_hq") return "40HQ";
  return t;
}

async function loadPo(id: string) {
  return db.purchaseOrder.findUnique({
    where: { id },
    include: {
      factory: { select: { name: true, country: true, vendorCode: true } },
      lineItems: {
        include: {
          sku: { select: { id: true, skuCode: true, name: true } },
          container: {
            select: {
              id: true,
              containerNumber: true,
              containerType: true,
              status: true,
              estimatedArrivalDate: true,
              actualArrivalDate: true,
              receivingNumber: true,
            },
          },
        },
        orderBy: [{ skuId: "asc" }],
      },
    },
  });
}

export default async function PoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const po = await loadPo(id);
  if (!po) notFound();

  const totalOrdered = po.lineItems.reduce((s, l) => s + l.quantityOrdered, 0);
  const totalReceived = po.lineItems.reduce((s, l) => s + l.quantityReceived, 0);
  const receivedPct = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;

  // Containers used by this PO (deduped, preserve order of first appearance)
  const seen = new Set<string>();
  const containers: Array<NonNullable<(typeof po.lineItems)[number]["container"]>> = [];
  for (const line of po.lineItems) {
    if (line.container && !seen.has(line.container.id)) {
      seen.add(line.container.id);
      containers.push(line.container);
    }
  }

  // Earliest container ETA (or PO-level fallback for legacy lines)
  const containerEtas = containers
    .map((c) => c.estimatedArrivalDate)
    .filter((d): d is Date => d != null);
  const effectiveEta =
    containerEtas.length > 0
      ? new Date(Math.min(...containerEtas.map((d) => d.getTime())))
      : po.estimatedArrivalDate;

  const today = new Date();
  let etaCardLabel = "ETA";
  let etaCardValue: string = fmtDate(effectiveEta);
  if (effectiveEta) {
    const days = Math.round(
      (new Date(effectiveEta).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (po.status === "received") {
      etaCardLabel = "Arrived";
    } else if (days < 0) {
      etaCardLabel = `${Math.abs(days)}d Late`;
    } else if (days === 0) {
      etaCardLabel = "Arriving Today";
    } else {
      etaCardLabel = `In ${days}d`;
    }
  }

  return (
    <div>
      <PageHeader title={`PO ${po.poNumber}`} />

      <div className="-mt-6 mb-6 flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(po.status)}>{statusLabel(po.status)}</Badge>
        {po.lotNumber && (
          <Badge variant="neutral">
            <span className="font-mono">Lot {po.lotNumber}</span>
          </Badge>
        )}
        <span className="text-sm text-[var(--c-text-secondary)]">
          {po.factory.name}
          {po.factory.country ? ` · ${po.factory.country}` : ""}
          {po.factory.vendorCode ? ` · ${po.factory.vendorCode}` : ""}
        </span>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Units Ordered" value={fmtInt(totalOrdered)} />
        <StatCard
          label="Units Received"
          value={`${fmtInt(totalReceived)} (${receivedPct.toFixed(0)}%)`}
          accent={receivedPct >= 100 ? "green" : receivedPct > 0 ? "amber" : "default"}
        />
        <StatCard
          label="Containers"
          value={containers.length === 0 ? "—" : String(containers.length)}
        />
        <StatCard label={etaCardLabel} value={etaCardValue} />
      </div>

      {/* Key dates */}
      <Card title="Key Dates" className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <DateField label="Order Placed" value={po.orderDate} />
          <DateField label="Factory Ready" value={po.factoryReadyDate} />
          <DateField label="Estimated Ship" value={po.estimatedShipDate} />
          <DateField label="Estimated Arrival" value={po.estimatedArrivalDate} />
          <DateField label="Actual Arrival" value={po.actualArrivalDate} />
          <DateField label="Closed" value={po.dateClosed} />
        </div>
      </Card>

      {/* Containers */}
      {containers.length > 0 && (
        <Card title="Containers" subtitle={`${containers.length} on this PO`} className="mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="py-2 font-medium">Container</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">ETA</th>
                <th className="py-2 font-medium">Arrived</th>
                <th className="py-2 font-medium">Receiving #</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr key={c.id} className="border-b border-[var(--c-border-row)]">
                  <td className="py-2 font-mono">{c.containerNumber}</td>
                  <td className="py-2">{containerTypeLabel(c.containerType) ?? "—"}</td>
                  <td className="py-2">
                    <Badge variant={statusVariant(c.status)}>{statusLabel(c.status)}</Badge>
                  </td>
                  <td className="py-2">{fmtDate(c.estimatedArrivalDate)}</td>
                  <td className="py-2 text-[var(--c-text-secondary)]">{fmtDate(c.actualArrivalDate)}</td>
                  <td className="py-2 font-mono text-xs">{c.receivingNumber ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Line items */}
      <Card
        title="Line Items"
        subtitle={`${po.lineItems.length} line${po.lineItems.length === 1 ? "" : "s"}`}
        className="mb-6"
      >
        {po.lineItems.length === 0 ? (
          <p className="text-sm text-[var(--c-text-tertiary)]">No line items on this PO.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                <th className="py-2 font-medium">SKU</th>
                <th className="py-2 font-medium text-right">Ordered</th>
                <th className="py-2 font-medium text-right">Received</th>
                <th className="py-2 font-medium">Container</th>
                <th className="py-2 font-medium">ETA</th>
                <th className="py-2 font-medium text-right">Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              {po.lineItems.map((line) => {
                const eta = line.container?.estimatedArrivalDate ?? po.estimatedArrivalDate;
                return (
                  <tr key={line.id} className="border-b border-[var(--c-border-row)]">
                    <td className="py-2">
                      <Link
                        href={`/skus/${line.sku.id}`}
                        className="text-[var(--c-accent)] hover:underline font-mono"
                      >
                        {line.sku.skuCode}
                      </Link>
                      <span className="text-xs text-[var(--c-text-tertiary)] ml-2">
                        {line.sku.name}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono">{fmtInt(line.quantityOrdered)}</td>
                    <td className="py-2 text-right font-mono text-[var(--c-text-secondary)]">
                      {fmtInt(line.quantityReceived)}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {line.container?.containerNumber ?? (
                        <span className="text-[var(--c-text-tertiary)]">—</span>
                      )}
                    </td>
                    <td className="py-2 text-[var(--c-text-secondary)]">{fmtDate(eta)}</td>
                    <td className="py-2 text-right font-mono text-[var(--c-text-secondary)]">
                      {fmtUsd(line.unitCostUsd as unknown as number | null)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-sm">
                <td className="py-2 text-right text-[var(--c-text-secondary)]">Total</td>
                <td className="py-2 text-right font-mono font-semibold">{fmtInt(totalOrdered)}</td>
                <td className="py-2 text-right font-mono font-semibold">{fmtInt(totalReceived)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {po.notes && (
        <Card title="Notes" className="mb-6">
          <p className="text-sm text-[var(--c-text-primary)] whitespace-pre-wrap">{po.notes}</p>
        </Card>
      )}

      <p className="text-xs text-[var(--c-text-tertiary)] mt-6">
        Created {fmtDate(po.createdAt)} · Updated {fmtDate(po.updatedAt)}
        {po.totalCostUsd ? ` · PO total ${fmtUsd(po.totalCostUsd as unknown as number)}` : ""}
      </p>
    </div>
  );
}

function DateField({ label, value }: { label: string; value: Date | string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--c-text-tertiary)]">{label}</p>
      <p className="text-sm font-medium text-[var(--c-text-primary)] mt-0.5">{fmtDate(value)}</p>
    </div>
  );
}
