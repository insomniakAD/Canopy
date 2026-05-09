import { db } from "@/lib/db";
import { auth } from "@/auth";
import { Card, Badge } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { ImportClient } from "./import-client";
import { StagedBannerClient } from "./staged-banner-client";

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

const FRESHNESS_CATEGORIES = [
  {
    label: "Core",
    sources: [
      { key: "amazon_sales", label: "Amazon Sales Diagnostic" },
      { key: "amazon_vendor_central", label: "Amazon Vendor Central" },
      { key: "amazon_forecast", label: "Amazon Forecasting" },
    ],
  },
  {
    label: "Periodic",
    sources: [
      { key: "di_orders", label: "DI Orders" },
    ],
  },
] as const;

function freshnessVariant(date: Date | null): "success" | "warning" | "error" | "neutral" {
  if (!date) return "neutral";
  const days = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 7) return "success";
  if (days <= 14) return "warning";
  return "error";
}

function freshnessLabel(date: Date | null): string {
  if (!date) return "Never";
  const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
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

interface StagedBatch {
  id: string;
  importType: string;
  fileName: string;
  createdAt: Date;
}

async function loadStagedBatches(userId: string | undefined): Promise<StagedBatch[]> {
  if (!userId) return [];
  try {
    return await db.importBatch.findMany({
      where: { stagingStatus: "staged", uploadedById: userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, importType: true, fileName: true, createdAt: true },
    });
  } catch {
    return [];
  }
}

async function loadFreshness(): Promise<Record<string, Date | null>> {
  const allKeys = FRESHNESS_CATEGORIES.flatMap((c) => c.sources.map((s) => s.key));
  try {
    const rows = await db.importBatch.groupBy({
      by: ["importType"],
      where: {
        status: "completed",
        importType: { in: [...allKeys] },
        // Exclude cancelled staged batches — they were never written.
        // Legacy direct-commit batches have null stagingStatus, hence the OR.
        OR: [{ stagingStatus: "committed" }, { stagingStatus: null }],
      },
      _max: { createdAt: true },
    });
    const map: Record<string, Date | null> = Object.fromEntries(allKeys.map((k) => [k, null]));
    for (const row of rows) {
      map[row.importType] = row._max.createdAt ?? null;
    }
    return map;
  } catch {
    return Object.fromEntries(allKeys.map((k) => [k, null]));
  }
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ forbidden?: string }>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [data, freshness, sp, stagedBatches] = await Promise.all([
    loadHistory(),
    loadFreshness(),
    searchParams,
    loadStagedBatches(userId),
  ]);
  const completedTypes = Object.entries(freshness).filter(([, d]) => d !== null).map(([k]) => k);
  const showForbidden = sp.forbidden === "admin";

  return (
    <div>
      <PageHeader title="Import Amazon Data" />
      <p className="text-sm text-[var(--c-text-tertiary)] mb-5">
        Upload Amazon Vendor Central reports until Golf&apos;s API is wired in. WDS data
        flows through{" "}
        <a href="/admin/sync" className="text-[var(--c-accent)] hover:underline">
          Admin → Live Sync
        </a>
        .
      </p>

      {showForbidden && (
        <div className="mb-6 bg-[var(--c-error-bg)] border border-[var(--c-error-border)] rounded-xl px-5 py-4">
          <p className="text-sm text-[var(--c-error-text)] font-medium">
            Admin-only area
          </p>
          <p className="text-xs text-[var(--c-error-text-mid)] mt-1">
            You don&apos;t have permission to view the Admin section. Contact papp or golf if you need access.
          </p>
        </div>
      )}

      {/* Staged-upload banner */}
      {stagedBatches.length > 0 && (
        <StagedBannerClient batches={stagedBatches} />
      )}

      {/* Data freshness */}
      <Card title="Data Freshness" className="mb-6">
        <div className="space-y-7 py-2">
          {FRESHNESS_CATEGORIES.map((cat) => (
            <div key={cat.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] mb-4">
                {cat.label}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-3.5">
                {cat.sources.map((source) => {
                  const date = freshness[source.key] ?? null;
                  return (
                    <div key={source.key} className="flex items-center justify-between gap-3">
                      <span className="text-sm font-light text-[var(--c-text-primary)]">{source.label}</span>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {date && (
                          <span className="text-xs font-light text-[var(--c-text-tertiary)] whitespace-nowrap">
                            {fmtDate(date)}
                          </span>
                        )}
                        <Badge variant={freshnessVariant(date)}>{freshnessLabel(date)}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <ImportClient completedTypes={completedTypes} />

      {/* Import guide */}
      <Card title="Supported File Types" className="mt-8 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium text-[var(--c-text-primary)] mb-1">Amazon Reports</p>
            <ul className="space-y-1 text-[var(--c-text-secondary)]">
              <li>&bull; <strong>Sales Diagnostic</strong> — Shipped units and revenue by ASIN</li>
              <li>&bull; <strong>Vendor Central</strong> — Operational metrics (OOS%, fill rate)</li>
              <li>&bull; <strong>Forecasting</strong> — 48-week demand forecast by ASIN</li>
              <li>&bull; <strong>DI Orders</strong> — Amazon Direct Import orders</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-[var(--c-text-primary)] mb-1">Where other data lives</p>
            <p className="text-[var(--c-text-secondary)]">
              WDS data (inventory, monthly sales, factory POs, PO line items, daily
              inventory) syncs nightly from Golf&apos;s Vercel Blob via{" "}
              <a href="/admin/sync" className="text-[var(--c-accent)] hover:underline">
                Admin → Live Sync
              </a>
              .
            </p>
            <p className="text-xs text-[var(--c-text-tertiary)] mt-2">
              SKU definition uploads (Item Update, Kit Composition, ASIN Mapping) live under{" "}
              <a href="/admin/uploads" className="text-[var(--c-accent)] hover:underline">
                Admin → Uploads
              </a>
              .
            </p>
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
