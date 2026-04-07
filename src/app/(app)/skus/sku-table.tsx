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
}

function fmtWos(v: number) {
  return `${v.toFixed(1)}w`;
}

function fmtDate(d: string | null) {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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
    }));
  }, [filtered]);

  return (
    <div className="bg-[var(--c-card-bg)] rounded-xl border border-[var(--c-border)] shadow-sm">
      {/* Filters bar */}
      <div className="px-6 py-4 border-b border-[var(--c-border)] flex flex-wrap items-center gap-3">
        {/* Decision filter */}
        <div className="flex rounded-lg border border-[var(--c-border)] overflow-hidden text-sm">
          {[
            { value: "all", label: "All" },
            { value: "order", label: "Order" },
            { value: "watch", label: "Watch" },
            { value: "do_not_order", label: "Do Not Order" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                filter === opt.value
                  ? "bg-[var(--c-accent)] text-white"
                  : "text-[var(--c-text-secondary)] hover:bg-[var(--c-border-row)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Tier filter */}
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-sm bg-[var(--c-card-bg)]"
        >
          <option value="all">All Tiers</option>
          <option value="A">Tier A</option>
          <option value="B">Tier B</option>
          <option value="C">Tier C</option>
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search SKU, name, or ASIN\u2026"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-[var(--c-border)] rounded-lg px-3 py-1.5 text-sm bg-[var(--c-card-bg)] flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)]"
        />

        <span className="text-xs text-[var(--c-text-tertiary)] ml-auto">
          {filtered.length} of {recommendations.length} SKUs
        </span>
        <ExportButton data={exportData} filename="canopy-sku-recommendations.csv" />
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
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-6 py-8 text-center text-[var(--c-text-tertiary)]">
                  No SKUs match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-b border-[var(--c-border-row)] hover:bg-[var(--c-page-bg)]">
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
                  <td className="px-4 py-3 text-right font-mono">{r.weeklyDemand.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.onHandInventory.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.inboundInventory.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span className={r.weeksOfSupply < 4 ? "text-[var(--c-error)] font-semibold" : ""}>
                      {fmtWos(r.weeksOfSupply)}
                    </span>
                    <span className="text-[var(--c-text-tertiary)]"> / {fmtWos(r.targetWeeksOfSupply)}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {r.adjustedQuantity > 0 ? r.adjustedQuantity.toLocaleString() : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-[var(--c-text-secondary)]">{r.factory ?? "\u2014"}</td>
                  <td className="px-4 py-3 text-[var(--c-text-secondary)]">{fmtDate(r.orderByDate)}</td>
                  <td className="px-4 py-3">
                    <span className={r.projectedStockoutDate ? "text-[var(--c-error)] font-medium" : "text-[var(--c-text-secondary)]"}>
                      {fmtDate(r.projectedStockoutDate)}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
