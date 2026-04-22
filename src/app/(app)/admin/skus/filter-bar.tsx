"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useEffect, useTransition } from "react";

export type FlagKey =
  | "missing_asin"
  | "missing_fcl"
  | "missing_cost"
  | "no_vendor"
  | "no_sales"
  | "broken_kit";

interface FilterBarProps {
  vendors: string[];
}

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "discontinued", label: "Discontinued" },
  { value: "all", label: "All Statuses" },
];

const TIER_OPTIONS = [
  { value: "all", label: "All Tiers" },
  { value: "A", label: "Tier A" },
  { value: "B", label: "Tier B" },
  { value: "C", label: "Tier C" },
];

const KIT_OPTIONS = [
  { value: "all", label: "All Kit Roles" },
  { value: "parent", label: "Parent" },
  { value: "child", label: "Child" },
  { value: "standalone", label: "Standalone" },
];

export function FilterBar({ vendors }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state mirrors URL — initialized from URL params
  const [q, setQ] = useState(params.get("q") ?? "");

  // Sync local input if URL changes externally
  useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === "" || value === "all") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    next.delete("page"); // reset pagination on filter change
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  function toggleFlag(flag: FlagKey) {
    const current = (params.get("flags") ?? "").split(",").filter(Boolean);
    const has = current.includes(flag);
    const next = has ? current.filter((f) => f !== flag) : [...current, flag];
    updateParam("flags", next.join(","));
  }

  function flagActive(flag: FlagKey) {
    return (params.get("flags") ?? "").split(",").includes(flag);
  }

  // Submit search on Enter or blur
  function applySearch() {
    updateParam("q", q.trim() || null);
  }

  return (
    <div className="space-y-3 mb-4">
      {/* Top row: search + dropdowns */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={applySearch}
          onKeyDown={(e) => {
            if (e.key === "Enter") applySearch();
          }}
          placeholder="Search SKU code or name…"
          className="flex-1 min-w-[200px] border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
        />

        <select
          value={params.get("status") ?? "active"}
          onChange={(e) => updateParam("status", e.target.value)}
          className="border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={params.get("vendor") ?? "all"}
          onChange={(e) => updateParam("vendor", e.target.value)}
          className="border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
        >
          <option value="all">All Vendors</option>
          {vendors.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          value={params.get("tier") ?? "all"}
          onChange={(e) => updateParam("tier", e.target.value)}
          className="border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
        >
          {TIER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={params.get("kit") ?? "all"}
          onChange={(e) => updateParam("kit", e.target.value)}
          className="border border-[var(--c-border)] rounded-lg px-3 py-2 text-sm bg-[var(--c-card-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] focus:border-transparent"
        >
          {KIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {isPending && (
          <span className="text-xs text-[var(--c-text-tertiary)]">Loading…</span>
        )}
      </div>

      {/* Flag toggles */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-medium text-[var(--c-text-secondary)] uppercase tracking-wide mr-1">
          Data Quality:
        </span>
        {(
          [
            ["missing_asin", "Missing ASIN"],
            ["missing_fcl", "Missing FCL"],
            ["missing_cost", "Missing MOQ/Cost"],
            ["no_vendor", "No Vendor"],
            ["no_sales", "No Sales History"],
            ["broken_kit", "Broken Kit Parent"],
          ] as Array<[FlagKey, string]>
        ).map(([key, label]) => {
          const active = flagActive(key);
          return (
            <button
              key={key}
              onClick={() => toggleFlag(key)}
              className={`px-3 py-1 text-xs rounded-full font-medium border transition-colors ${
                active
                  ? "bg-[var(--c-accent)] text-white border-[var(--c-accent)]"
                  : "bg-[var(--c-card-bg)] text-[var(--c-text-secondary)] border-[var(--c-border)] hover:border-[var(--c-text-tertiary)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
