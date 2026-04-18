import { db } from "@/lib/db";
import { Card, Badge } from "@/components/ui";
import { ImportClient } from "./import-client";

function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function typeLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadHistory() {
  try {
    const batches = await db.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        errors: { take: 10, orderBy: { rowNumber: "asc" } },
      },
    });
    return { ok: true as const, batches };
  } catch {
    return { ok: false as const, batches: [] };
  }
}

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

export default async function ImportPage() {
  const [data, completedTypes] = await Promise.all([
    loadHistory(),
    loadCompletedTypes(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--c-text-primary)] mb-1">Import Data</h1>
      <p className="text-sm text-[var(--c-text-secondary)] mb-6">
        Upload Excel or CSV files from WDS and Amazon to keep Canopy&apos;s data current.
      </p>

      <ImportClient completedTypes={completedTypes} />

      {/* Import guide */}
      <Card title="Supported File Types" className="mt-8 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium text-[var(--c-text-primary)] mb-1">WDS Exports</p>
            <ul className="space-y-1 text-[var(--c-text-secondary)]">
              <li>&bull; <strong>WDS Inventory</strong> — Current stock levels by SKU</li>
              <li>&bull; <strong>WDS Monthly Sales</strong> — Pivot table with SKUs as rows, months as columns</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-[var(--c-text-primary)] mb-1">Amazon Reports</p>
            <ul className="space-y-1 text-[var(--c-text-secondary)]">
              <li>&bull; <strong>Sales Diagnostic</strong> — Shipped units and revenue by ASIN</li>
              <li>&bull; <strong>Vendor Central</strong> — Operational metrics (OOS%, fill rate)</li>
              <li>&bull; <strong>Forecasting</strong> — 48-week demand forecast by ASIN</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-[var(--c-text-primary)] mb-1">Other</p>
            <ul className="space-y-1 text-[var(--c-text-secondary)]">
              <li>&bull; <strong>Purchase Orders</strong> — Open and historical POs from WDS</li>
              <li>&bull; <strong>ASIN Mapping</strong> — Links Amazon ASINs to WDS SKU codes</li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Import history */}
      <Card
        title="Import History"
        subtitle={data.ok ? `${data.batches.length} recent imports` : "Could not load history"}
      >
        {!data.ok ? (
          <p className="text-sm text-[var(--c-text-tertiary)] py-4">Database not connected.</p>
        ) : data.batches.length === 0 ? (
          <p className="text-sm text-[var(--c-text-tertiary)] py-4">No imports yet. Upload a file above to get started.</p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">File</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Imported</th>
                  <th className="px-6 py-3 font-medium text-right">Skipped</th>
                  <th className="px-6 py-3 font-medium text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.batches.map((b) => {
                  const statusVar: Record<string, "success" | "warning" | "error" | "neutral"> = {
                    completed: "success",
                    processing: "warning",
                    failed: "error",
                    pending: "neutral",
                  };
                  return (
                    <tr key={b.id} className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-page-bg)]">
                      <td className="px-6 py-3 text-[var(--c-text-secondary)] whitespace-nowrap">{fmtDate(b.createdAt)}</td>
                      <td className="px-6 py-3">{typeLabel(b.importType)}</td>
                      <td className="px-6 py-3 font-medium truncate max-w-[200px]">{b.fileName}</td>
                      <td className="px-6 py-3">
                        <Badge variant={statusVar[b.status] ?? "neutral"}>{b.status}</Badge>
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-[var(--c-success)]">{b.rowsImported}</td>
                      <td className="px-6 py-3 text-right font-mono text-[var(--c-warning)]">{b.rowsSkipped}</td>
                      <td className="px-6 py-3 text-right font-mono text-[var(--c-error)]">{b.rowsErrored}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
