import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { Card, Badge, TierBadge } from "@/components/ui";
import { FilterBar, type FlagKey } from "./filter-bar";

const PAGE_SIZE = 100;

type RawSearchParams = Record<string, string | string[] | undefined>;

interface ParsedFilters {
  q: string;
  status: "active" | "discontinued" | "all";
  vendor: string | null;
  tier: "A" | "B" | "C" | null;
  kit: "parent" | "child" | "standalone" | null;
  flags: Set<FlagKey>;
  page: number;
}

function pickString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function parseFilters(sp: RawSearchParams): ParsedFilters {
  const status = pickString(sp.status) as ParsedFilters["status"];
  const tierRaw = pickString(sp.tier);
  const kitRaw = pickString(sp.kit);
  const flags = new Set(
    pickString(sp.flags)
      .split(",")
      .filter(Boolean) as FlagKey[]
  );
  const page = Math.max(1, parseInt(pickString(sp.page) || "1", 10) || 1);

  return {
    q: pickString(sp.q).trim(),
    status: status === "discontinued" || status === "all" ? status : "active",
    vendor: pickString(sp.vendor) || null,
    tier: tierRaw === "A" || tierRaw === "B" || tierRaw === "C" ? tierRaw : null,
    kit: kitRaw === "parent" || kitRaw === "child" || kitRaw === "standalone" ? kitRaw : null,
    flags,
    page,
  };
}

function buildWhere(f: ParsedFilters): Prisma.SkuWhereInput {
  const AND: Prisma.SkuWhereInput[] = [];

  if (f.status !== "all") {
    AND.push({ status: f.status });
  }
  if (f.q) {
    AND.push({
      OR: [
        { skuCode: { contains: f.q, mode: "insensitive" } },
        { name: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  if (f.vendor) {
    AND.push({ vendorCode: f.vendor });
  }
  if (f.tier) {
    AND.push({ tier: f.tier });
  }
  if (f.kit === "parent") AND.push({ isKitParent: true });
  if (f.kit === "child") AND.push({ isKitComponent: true });
  if (f.kit === "standalone") AND.push({ isKitParent: false, isKitComponent: false });

  if (f.flags.has("missing_asin")) AND.push({ asin: null });
  if (f.flags.has("missing_fcl")) AND.push({ OR: [{ fclQty40GP: null }, { fclQty40HQ: null }] });
  if (f.flags.has("missing_cost")) AND.push({ OR: [{ moq: null }, { unitCostUsd: null }] });
  if (f.flags.has("no_vendor")) AND.push({ vendorCode: null });
  if (f.flags.has("no_sales")) AND.push({ salesHistory: { none: {} } });
  if (f.flags.has("broken_kit")) AND.push({ isKitParent: true, kitComponentsAsParent: { none: {} } });

  return AND.length ? { AND } : {};
}

async function loadFlagCounts(activeOnly: Prisma.SkuWhereInput) {
  const baseWhere = activeOnly;
  return Promise.all([
    db.sku.count({ where: { ...baseWhere, asin: null } }),
    db.sku.count({ where: { ...baseWhere, OR: [{ fclQty40GP: null }, { fclQty40HQ: null }] } }),
    db.sku.count({ where: { ...baseWhere, OR: [{ moq: null }, { unitCostUsd: null }] } }),
    db.sku.count({ where: { ...baseWhere, vendorCode: null } }),
    db.sku.count({ where: { ...baseWhere, salesHistory: { none: {} } } }),
    db.sku.count({ where: { ...baseWhere, isKitParent: true, kitComponentsAsParent: { none: {} } } }),
  ]).then(([missingAsin, missingFcl, missingCost, noVendor, noSales, brokenKit]) => ({
    missingAsin,
    missingFcl,
    missingCost,
    noVendor,
    noSales,
    brokenKit,
  }));
}

async function loadVendorList(): Promise<string[]> {
  const rows = await db.sku.findMany({
    where: { vendorCode: { not: null } },
    select: { vendorCode: true },
    distinct: ["vendorCode"],
    orderBy: { vendorCode: "asc" },
  });
  return rows.map((r) => r.vendorCode!).filter(Boolean);
}

async function loadVendorCountryMap(): Promise<Record<string, string>> {
  const factories = await db.factory.findMany({
    where: { vendorCode: { not: null } },
    select: { vendorCode: true, country: true },
  });
  const map: Record<string, string> = {};
  for (const f of factories) {
    if (f.vendorCode && f.country) map[f.vendorCode] = f.country;
  }
  return map;
}

async function loadAggregates(skuIds: string[]) {
  if (skuIds.length === 0) {
    return {
      wdsOnHand: new Map<string, number>(),
      amazonOnHand: new Map<string, number>(),
      openPo: new Map<string, number>(),
      forecastTotal: new Map<string, number>(),
      lastSale: new Map<string, Date>(),
    };
  }

  const [
    wdsLatest,
    amzLatest,
    forecastLatestRow,
    openPoRows,
    lastSaleRows,
  ] = await Promise.all([
    db.inventorySnapshot.findFirst({
      where: { location: { name: "Woodinville Warehouse" } },
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true, locationId: true },
    }),
    db.inventorySnapshot.findFirst({
      where: { location: { name: "Amazon FC" } },
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true, locationId: true },
    }),
    db.amazonForecast.findFirst({
      orderBy: { snapshotDate: "desc" },
      select: { snapshotDate: true },
    }),
    db.poLineItem.findMany({
      where: {
        skuId: { in: skuIds },
        purchaseOrder: { status: { notIn: ["received", "cancelled"] } },
      },
      select: { skuId: true, quantityOrdered: true, quantityReceived: true },
    }),
    db.salesRecord.groupBy({
      by: ["skuId"],
      where: { skuId: { in: skuIds } },
      _max: { saleDate: true },
    }),
  ]);

  const wdsOnHand = new Map<string, number>();
  const amazonOnHand = new Map<string, number>();
  const openPo = new Map<string, number>();
  const forecastTotal = new Map<string, number>();
  const lastSale = new Map<string, Date>();

  if (wdsLatest) {
    const snaps = await db.inventorySnapshot.findMany({
      where: {
        skuId: { in: skuIds },
        locationId: wdsLatest.locationId,
        snapshotDate: wdsLatest.snapshotDate,
      },
      select: { skuId: true, quantityOnHand: true },
    });
    for (const s of snaps) wdsOnHand.set(s.skuId, s.quantityOnHand);
  }

  if (amzLatest) {
    const snaps = await db.inventorySnapshot.findMany({
      where: {
        skuId: { in: skuIds },
        locationId: amzLatest.locationId,
        snapshotDate: amzLatest.snapshotDate,
      },
      select: { skuId: true, quantityOnHand: true },
    });
    for (const s of snaps) amazonOnHand.set(s.skuId, s.quantityOnHand);
  }

  for (const li of openPoRows) {
    const remaining = li.quantityOrdered - li.quantityReceived;
    if (remaining <= 0) continue;
    openPo.set(li.skuId, (openPo.get(li.skuId) ?? 0) + remaining);
  }

  if (forecastLatestRow) {
    const sums = await db.amazonForecast.groupBy({
      by: ["skuId"],
      where: { skuId: { in: skuIds }, snapshotDate: forecastLatestRow.snapshotDate },
      _sum: { forecastUnits: true },
    });
    for (const r of sums) {
      forecastTotal.set(r.skuId, Number(r._sum.forecastUnits ?? 0));
    }
  }

  for (const r of lastSaleRows) {
    if (r._max.saleDate) lastSale.set(r.skuId, r._max.saleDate);
  }

  return { wdsOnHand, amazonOnHand, openPo, forecastTotal, lastSale };
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDateShort(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function kitRoleLabel(isParent: boolean, isComponent: boolean): string {
  if (isParent) return "Parent";
  if (isComponent) return "Child";
  return "Standalone";
}

function kitRoleVariant(isParent: boolean, isComponent: boolean): "info" | "warning" | "neutral" {
  if (isParent) return "info";
  if (isComponent) return "warning";
  return "neutral";
}

function buildFlagHref(flag: FlagKey, current: ParsedFilters): string {
  const params = new URLSearchParams();
  if (current.status !== "active") params.set("status", current.status);
  if (current.q) params.set("q", current.q);
  if (current.vendor) params.set("vendor", current.vendor);
  if (current.tier) params.set("tier", current.tier);
  if (current.kit) params.set("kit", current.kit);
  // Toggle the clicked flag
  const flagsCopy = new Set(current.flags);
  if (flagsCopy.has(flag)) flagsCopy.delete(flag);
  else flagsCopy.add(flag);
  if (flagsCopy.size > 0) params.set("flags", Array.from(flagsCopy).join(","));
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

export default async function AdminSkusPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const where = buildWhere(filters);
  const skip = (filters.page - 1) * PAGE_SIZE;

  const [total, rows, vendors, vendorCountry, flagCounts, totalActive] = await Promise.all([
    db.sku.count({ where }),
    db.sku.findMany({
      where,
      orderBy: [{ skuCode: "asc" }],
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        skuCode: true,
        name: true,
        asin: true,
        status: true,
        tier: true,
        autoTier: true,
        vendorCode: true,
        unitCostUsd: true,
        moq: true,
        fclQty40GP: true,
        fclQty40HQ: true,
        isDiEligible: true,
        isKitParent: true,
        isKitComponent: true,
      },
    }),
    loadVendorList(),
    loadVendorCountryMap(),
    loadFlagCounts({ status: "active" }),
    db.sku.count({ where: { status: "active" } }),
  ]);

  const skuIds = rows.map((r) => r.id);
  const aggs = await loadAggregates(skuIds);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const flagChips: Array<{ key: FlagKey; label: string; count: number }> = [
    { key: "missing_asin", label: "Missing ASIN", count: flagCounts.missingAsin },
    { key: "missing_fcl", label: "Missing FCL", count: flagCounts.missingFcl },
    { key: "missing_cost", label: "Missing MOQ/Cost", count: flagCounts.missingCost },
    { key: "no_vendor", label: "No Vendor", count: flagCounts.noVendor },
    { key: "no_sales", label: "No Sales History", count: flagCounts.noSales },
    { key: "broken_kit", label: "Broken Kit Parent", count: flagCounts.brokenKit },
  ];

  return (
    <div>
      {/* Summary chips — always reflect Active SKUs (audit baseline) */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--c-text-primary)] mr-2">
            {totalActive.toLocaleString()} active SKUs
          </span>
          <span className="text-[var(--c-border)]">·</span>
          {flagChips.map((c) => {
            const variant: "error" | "warning" | "neutral" =
              c.count === 0 ? "neutral" : c.key === "broken_kit" || c.key === "no_vendor" ? "error" : "warning";
            return (
              <Link
                key={c.key}
                href={buildFlagHref(c.key, filters)}
                className="inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              >
                <Badge variant={variant}>
                  {c.count.toLocaleString()} {c.label}
                </Badge>
              </Link>
            );
          })}
        </div>
      </Card>

      <FilterBar vendors={vendors} />

      <Card
        title="SKUs"
        subtitle={`${total.toLocaleString()} matching · page ${filters.page} of ${totalPages}`}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--c-text-tertiary)] py-8 text-center">
            No SKUs match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">ASIN</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 font-medium">Kit</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">On-Hand WDS</th>
                  <th className="px-4 py-3 font-medium text-right">On-Hand Amazon</th>
                  <th className="px-4 py-3 font-medium text-right">Open PO</th>
                  <th className="px-4 py-3 font-medium text-right">Total Forecasted</th>
                  <th className="px-4 py-3 font-medium">Vendor</th>
                  <th className="px-4 py-3 font-medium text-right">Unit Cost</th>
                  <th className="px-4 py-3 font-medium text-right">MOQ</th>
                  <th className="px-4 py-3 font-medium text-right">FCL 40GP / 40HQ</th>
                  <th className="px-4 py-3 font-medium text-center">DI</th>
                  <th className="px-4 py-3 font-medium">Last Sale</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tierMismatch = r.autoTier && r.autoTier !== r.tier;
                  const country = r.vendorCode ? vendorCountry[r.vendorCode] : null;
                  return (
                    <tr key={r.id} className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-page-bg)]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/skus/${r.id}`}
                          className="font-medium text-[var(--c-text-primary)] hover:text-[var(--c-accent)]"
                        >
                          {r.skuCode}
                        </Link>
                        <div className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[220px]">
                          {r.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.asin ?? "—"}</td>
                      <td className="px-4 py-3">
                        <TierBadge tier={r.tier} />
                        {tierMismatch && (
                          <div className="text-xs text-[var(--c-text-tertiary)] mt-0.5">
                            auto: {r.autoTier}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={kitRoleVariant(r.isKitParent, r.isKitComponent)}>
                          {kitRoleLabel(r.isKitParent, r.isKitComponent)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={r.status === "active" ? "success" : "neutral"}>{r.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{fmtNum(aggs.wdsOnHand.get(r.id))}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtNum(aggs.amazonOnHand.get(r.id))}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtNum(aggs.openPo.get(r.id))}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {fmtNum(
                          aggs.forecastTotal.has(r.id)
                            ? Math.round(aggs.forecastTotal.get(r.id)!)
                            : null
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.vendorCode ? (
                          <span>
                            {r.vendorCode}
                            {country && (
                              <span className="text-xs text-[var(--c-text-tertiary)] ml-1">
                                ({country})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[var(--c-text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {fmtMoney(r.unitCostUsd ? Number(r.unitCostUsd) : null)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{fmtNum(r.moq)}</td>
                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                        {fmtNum(r.fclQty40GP)} / {fmtNum(r.fclQty40HQ)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.isDiEligible ? (
                          <span className="text-[var(--c-success)]">✓</span>
                        ) : (
                          <span className="text-[var(--c-text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-[var(--c-text-secondary)]">
                        {fmtDateShort(aggs.lastSale.get(r.id))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <Pagination current={filters.page} totalPages={totalPages} sp={sp} />
        )}
      </Card>
    </div>
  );
}

function Pagination({
  current,
  totalPages,
  sp,
}: {
  current: number;
  totalPages: number;
  sp: RawSearchParams;
}) {
  function pageHref(page: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (k === "page") continue;
      if (typeof v === "string" && v) params.set(k, v);
    }
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  }

  const prevPage = Math.max(1, current - 1);
  const nextPage = Math.min(totalPages, current + 1);

  return (
    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--c-border)]">
      <Link
        href={pageHref(prevPage)}
        className={`px-3 py-1.5 text-sm rounded-lg border border-[var(--c-border)] ${
          current === 1
            ? "text-[var(--c-text-tertiary)] pointer-events-none"
            : "text-[var(--c-text-primary)] hover:bg-[var(--c-page-bg)]"
        }`}
      >
        ← Previous
      </Link>
      <span className="text-sm text-[var(--c-text-secondary)]">
        Page {current} of {totalPages}
      </span>
      <Link
        href={pageHref(nextPage)}
        className={`px-3 py-1.5 text-sm rounded-lg border border-[var(--c-border)] ${
          current === totalPages
            ? "text-[var(--c-text-tertiary)] pointer-events-none"
            : "text-[var(--c-text-primary)] hover:bg-[var(--c-page-bg)]"
        }`}
      >
        Next →
      </Link>
    </div>
  );
}
