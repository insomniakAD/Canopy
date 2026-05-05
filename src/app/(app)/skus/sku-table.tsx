"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge, TierBadge } from "@/components/ui";
import { ExportButton } from "@/components/export-button";

interface Rec {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  tier: string;
  asin: string | null;
  decision: string;
  weeklyDemand: number;
  onHandInventory: number;
  inboundInventory: number;
  weeksOfSupply: number;
  targetWeeksOfSupply: number;
  reorderQuantity: number;
  adjustedQuantity: number;
  amazonForecastWeekly: number | null;
  forecastVariancePct: number | null;
  factory: string | null;
  orderByDate: string | null;
  projectedStockoutDate: string | null;
  grossMarginPct: number | null;
  markupPct: number | null;
}

function fmtWos(v: number) {
  return `${v.toFixed(1)}wk`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const DECISION_FILTERS = [
  { value: "all", label: "All" },
  { value: "order", label: "Order" },
  { value: "watch", label: "Watch" },
  { value: "do_not_order", label: "Do Not Order" },
] as const;

const TIER_FILTERS = [
  { value: "all", label: "All Tiers" },
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
  { value: "LP", label: "LP" },
] as const;

// Row priority styling — tint matches the left-edge bar but at lower opacity
const ROW_STYLES: Record<string, { bg: string; bar: string }> = {
  order: {
    bg: "bg-[var(--c-error-bg-light)]",
    bar: "var(--c-error)",
  },
  watch: {
    bg: "bg-[var(--c-warning-bg)]/30",
    bar: "var(--c-warning)",
  },
  do_not_order: {
    bg: "",
    bar: "transparent",
  },
};

export function SkuTable({ recommendations }: { recommendations: Rec[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return recommendations.filter((r) => {
      if (filter !== "all" && r.decision !== filter) return false;
      if (tierFilter !== "all" && r.tier !== tierFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.skuCode.toLowerCase().includes(q) &&
          !r.skuName.toLowerCase().includes(q) &&
          !(r.asin ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [recommendations, filter, search, tierFilter]);

  const exportData = useMemo(() => {
    return filtered.map((r) => ({
      SKU: r.skuCode,
      Name: r.skuName,
      Tier: r.tier,
      Decision: r.decision,
      "Weekly Demand": r.weeklyDemand.toFixed(1),
      "On Hand": r.onHandInventory,
      Inbound: r.inboundInventory,
      "Weeks of Supply": r.weeksOfSupply.toFixed(1),
      "Order Qty": r.adjustedQuantity > 0 ? r.adjustedQuantity : "",
      Factory: r.factory ?? "",
      "Order By": r.orderByDate ?? "",
      "Stockout Date": r.projectedStockoutDate ?? "",
      "Gross Margin %": r.grossMarginPct != null ? r.grossMarginPct.toFixed(1) : "",
      "Markup %": r.markupPct != null ? r.markupPct.toFixed(1) : "",
    }));
  }, [filtered]);

  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)]">
      {/* Filters bar */}
      <div className="px-6 py-4 border-b border-[var(--c-border)] flex flex-wrap items-center gap-2">
        {/* Decision pills */}
        {DECISION_FILTERS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              filter === opt.value
                ? "bg-[var(--c-accent)] text-white border-[var(--c-accent)]"
                : "border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-surface)]"
            }`}
          >
            {opt.label}
          </button>
        ))}

        {/* Tier pills */}
        <div className="w-px h-5 bg-[var(--c-border)] mx-1" />
        {TIER_FILTERS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTierFilter(opt.value)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              tierFilter === opt.value
                ? "bg-[var(--c-accent)] text-white border-[var(--c-accent)]"
                : "border-[var(--c-border)] text-[var(--c-text-secondary)] hover:bg-[var(--c-surface)]"
            }`}
          >
            {opt.label}
          </button>
        ))}

        {/* Search + count + export, right-aligned */}
        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            placeholder="Search SKU, name, or ASIN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-sm bg-[var(--c-card-bg)] w-56 focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)]"
          />
          <span className="text-xs text-[var(--c-text-tertiary)] whitespace-nowrap">
            {filtered.length} of {recommendations.length}
          </span>
          <ExportButton data={exportData} filename="canopy-sku-recommendations.csv" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--c-text-secondary)] text-xs uppercase tracking-wide border-b border-[var(--c-border)]">
              <th className="px-6 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 font-medium">Decision</th>
              <th className="px-4 py-3 font-medium text-right">Weekly Demand</th>
              <th className="px-4 py-3 font-medium text-right">On Hand</th>
              <th className="px-4 py-3 font-medium text-right">Inbound</th>
              <th className="px-4 py-3 font-medium text-right">Weeks of Supply</th>
              <th className="px-4 py-3 font-medium text-right">Order Qty</th>
              <th className="px-4 py-3 font-medium">Factory</th>
              <th className="px-4 py-3 font-medium">Order By</th>
              <th className="px-4 py-3 font-medium">Stockout</th>
              <th className="px-4 py-3 font-medium text-right">Margin</th>
              <th className="px-4 py-3 font-medium text-right">Markup</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-6 py-8 text-center text-[var(--c-text-tertiary)]">
                  No SKUs match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const styles = ROW_STYLES[r.decision] ?? ROW_STYLES.do_not_order;
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-[var(--c-border-row)] ${styles.bg} hover:bg-[var(--c-page-bg)]`}
                    style={{ boxShadow: `inset 3px 0 0 ${styles.bar}` }}
                  >
                    <td className="px-6 py-3">
                      <Link href={`/skus/${r.skuId}`} className="text-[var(--c-accent)] font-medium hover:underline">
                        {r.skuCode}
                      </Link>
                      <p className="text-xs text-[var(--c-text-tertiary)] truncate max-w-[180px]">{r.skuName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <TierBadge tier={r.tier} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={r.decision as "order" | "watch" | "do_not_order"} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.weeklyDemand.toFixed(1)}
                      <span className="text-[var(--c-text-tertiary)]"> /wk</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.onHandInventory.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.inboundInventory.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={r.weeksOfSupply < 4 ? "text-[var(--c-error)] font-semibold" : ""}>
                        {fmtWos(r.weeksOfSupply)}
                      </span>
                      <span className="text-[var(--c-text-tertiary)]"> / {fmtWos(r.targetWeeksOfSupply)}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {r.adjustedQuantity > 0 ? r.adjustedQuantity.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--c-text-secondary)]">{r.factory ?? "—"}</td>
                    <td className="px-4 py-3 text-[var(--c-text-secondary)]">{fmtDate(r.orderByDate)}</td>
                    <td className="px-4 py-3">
                      <span className={r.projectedStockoutDate ? "text-[var(--c-error)] font-medium" : "text-[var(--c-text-secondary)]"}>
                        {fmtDate(r.projectedStockoutDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--c-text-secondary)]">
                      {r.grossMarginPct != null ? `${r.grossMarginPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--c-text-secondary)]">
                      {r.markupPct != null ? `${r.markupPct.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
