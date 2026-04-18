import { db } from "@/lib/db";
import { Card } from "@/components/ui";
import { ItemsClient } from "./items-client";
import { TransitionsTable, type TransitionRow } from "./transitions-table";

async function loadCompletedTypes(): Promise<string[]> {
  try {
    const completed = await db.importBatch.findMany({
      where: { status: "completed" },
      select: { importType: true },
      distinct: ["importType"],
    });
    return completed.map((b) => b.importType);
  } catch {
    return [];
  }
}

async function loadPendingTransitions() {
  try {
    const rows = await db.pendingVendorTransition.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
      include: {
        sku: { select: { skuCode: true, name: true } },
        fromFactory: { select: { name: true, vendorCode: true } },
        toFactory: { select: { name: true, vendorCode: true } },
      },
      take: 50,
    });
    return { ok: true as const, rows };
  } catch {
    return { ok: false as const, rows: [] };
  }
}

export default async function ItemsPage() {
  const [completedTypes, transitions] = await Promise.all([
    loadCompletedTypes(),
    loadPendingTransitions(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--c-text-primary)] mb-1">
        Items &amp; Vendors
      </h1>
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        Bulk-update SKU attributes, add or update vendors, and rebuild kit
        relationships from a single Excel template.
      </p>

      <ItemsClient completedTypes={completedTypes} />

      <Card
        className="mt-6"
        title="Pending Vendor Transitions"
        subtitle={
          transitions.ok
            ? `${transitions.rows.length} awaiting first PO`
            : "Database not connected"
        }
      >
        {!transitions.ok ? (
          <p className="text-sm text-[var(--c-text-tertiary)] py-4">
            Database not connected.
          </p>
        ) : (
          <TransitionsTable
            rows={transitions.rows.map<TransitionRow>((t) => ({
              id: t.id,
              createdAt: t.createdAt.toISOString(),
              reason: t.reason,
              expectedFirstPoDate: t.expectedFirstPoDate
                ? t.expectedFirstPoDate.toISOString()
                : null,
              newVendorCode: t.newVendorCode,
              newUnitCost: t.newUnitCost != null ? Number(t.newUnitCost) : null,
              newMoq: t.newMoq,
              sku: { skuCode: t.sku.skuCode, name: t.sku.name },
              fromFactory: t.fromFactory
                ? { name: t.fromFactory.name, vendorCode: t.fromFactory.vendorCode }
                : null,
              toFactory: t.toFactory
                ? { name: t.toFactory.name, vendorCode: t.toFactory.vendorCode }
                : null,
            }))}
          />
        )}
      </Card>
    </div>
  );
}
