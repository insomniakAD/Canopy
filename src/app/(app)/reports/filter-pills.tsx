"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type PillOption = { value: string; label: string };

function FilterPill({
  label,
  options,
  isActive,
  isOpen,
  onToggle,
  onSelect,
  onClose,
}: {
  label: string;
  options: PillOption[];
  isActive: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onMouse);
    return () => document.removeEventListener("mousedown", onMouse);
  }, [isOpen, onClose]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-sm transition-colors ${
          isActive
            ? "border-[var(--c-accent)] bg-[var(--c-accent)]/10 text-[var(--c-accent)]"
            : "border-[var(--c-border)] bg-[var(--c-card-bg)] text-[var(--c-text-secondary)] hover:bg-[var(--c-surface)]"
        }`}
      >
        {label}
        <svg
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""} ${isActive ? "text-[var(--c-accent)]" : "text-[var(--c-text-tertiary)]"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1.5 bg-[var(--c-card-bg)] border border-[var(--c-border)] rounded-lg shadow-lg overflow-hidden z-50 min-w-[160px]">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className="w-full text-left px-4 py-2 text-sm text-[var(--c-text-secondary)] hover:bg-[var(--c-surface)] transition-colors first:pt-3 last:pb-3"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterPillsBar({
  channel,
  tier,
  period,
}: {
  channel: string;
  tier: string;
  period: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openPill, setOpenPill] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();

  const channelOptions: PillOption[] = [
    { value: "all", label: "All Channels" },
    { value: "amazon", label: "Amazon" },
    { value: "domestic", label: "Domestic" },
  ];

  const tierOptions: PillOption[] = [
    { value: "all", label: "All Tiers" },
    { value: "A", label: "Tier A" },
    { value: "B", label: "Tier B" },
    { value: "C", label: "Tier C" },
  ];

  const periodOptions: PillOption[] = Array.from({ length: 4 }, (_, i) => {
    const year = currentYear - i;
    return { value: String(year), label: year === currentYear ? `${year} YTD` : String(year) };
  });

  function updateParam(key: string, value: string, defaultValue: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const qs = params.toString();
    router.replace(pathname + (qs ? `?${qs}` : ""));
    setOpenPill(null);
  }

  const channelLabel = channelOptions.find((o) => o.value === channel)?.label ?? "All Channels";
  const tierLabel = tierOptions.find((o) => o.value === tier)?.label ?? "All Tiers";
  const periodLabel = periodOptions.find((o) => o.value === period)?.label ?? `${currentYear} YTD`;

  return (
    <div className="flex items-center gap-3 mb-6 flex-wrap">
      <FilterPill
        label={channelLabel}
        options={channelOptions}
        isActive={channel !== "all"}
        isOpen={openPill === "channel"}
        onToggle={() => setOpenPill((p) => (p === "channel" ? null : "channel"))}
        onSelect={(v) => updateParam("channel", v, "all")}
        onClose={() => setOpenPill(null)}
      />
      <FilterPill
        label={tierLabel}
        options={tierOptions}
        isActive={tier !== "all"}
        isOpen={openPill === "tier"}
        onToggle={() => setOpenPill((p) => (p === "tier" ? null : "tier"))}
        onSelect={(v) => updateParam("tier", v, "all")}
        onClose={() => setOpenPill(null)}
      />
      <FilterPill
        label={periodLabel}
        options={periodOptions}
        isActive={period !== String(currentYear)}
        isOpen={openPill === "period"}
        onToggle={() => setOpenPill((p) => (p === "period" ? null : "period"))}
        onSelect={(v) => updateParam("period", v, String(currentYear))}
        onClose={() => setOpenPill(null)}
      />
    </div>
  );
}
