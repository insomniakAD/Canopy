"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SkuHit = {
  id: string;
  skuCode: string;
  name: string;
  isKitParent: boolean;
};

type PoHit = {
  id: string;
  poNumber: string;
  lotNumber: string | null;
  status: string;
  factoryName: string | null;
};

type SearchResults = { skus: SkuHit[]; pos: PoHit[] };

type FlatHit =
  | { kind: "sku"; id: string; primary: string; secondary: string; href: string }
  | { kind: "po"; id: string; primary: string; secondary: string; href: string };

function flatten(results: SearchResults): FlatHit[] {
  const flat: FlatHit[] = [];
  for (const s of results.skus) {
    flat.push({
      kind: "sku",
      id: s.id,
      primary: s.skuCode,
      secondary: s.isKitParent ? `${s.name} · Kit Parent` : s.name,
      href: `/skus/${s.id}`,
    });
  }
  for (const p of results.pos) {
    const tail = [
      p.lotNumber ? `Lot ${p.lotNumber}` : null,
      p.factoryName,
      p.status.replace(/_/g, " "),
    ]
      .filter(Boolean)
      .join(" · ");
    flat.push({
      kind: "po",
      id: p.id,
      primary: `PO ${p.poNumber}`,
      secondary: tail,
      href: `/pos/${p.id}`,
    });
  }
  return flat;
}

function isMac() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export function SearchBar() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults>({ skus: [], pos: [] });
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [shortcutLabel, setShortcutLabel] = useState("⌘K");

  useEffect(() => {
    setShortcutLabel(isMac() ? "⌘K" : "Ctrl+K");
  }, []);

  // Global ⌘K / Ctrl+K hotkey
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close on click outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced fetch
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults({ skus: [], pos: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("search failed");
        const data: SearchResults = await res.json();
        setResults(data);
        setActiveIdx(0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResults({ skus: [], pos: [] });
        }
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => {
      ctrl.abort();
      clearTimeout(handle);
    };
  }, [q]);

  const flat = flatten(results);

  function pick(hit: FlatHit) {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || flat.length === 0) {
      if (e.key === "Enter") e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[activeIdx];
      if (hit) pick(hit);
    }
  }

  const showDropdown = open && q.trim().length >= 2;

  return (
    <div ref={containerRef} className="px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-sidebar-text-muted)] px-3 mb-1">
        Search
      </p>
      <div className="px-3 mt-1 relative">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-[var(--c-sidebar-text-muted)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="SKU, PO, or Lot…"
            className="w-full pl-9 pr-14 py-2 text-sm rounded-lg bg-[var(--c-sidebar-hover)] border border-transparent focus:outline-none focus:border-white/15 text-white placeholder:text-[var(--c-sidebar-text-muted)] font-light"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-[var(--c-sidebar-text-muted)] bg-black/20 px-1.5 py-0.5 rounded border border-white/10 pointer-events-none">
            {shortcutLabel}
          </kbd>
        </div>

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-[var(--c-card-bg)] border border-[var(--c-border)] rounded-lg shadow-lg overflow-hidden z-50 max-h-96 overflow-y-auto">
            {loading && flat.length === 0 && (
              <div className="px-3 py-3 text-xs text-[var(--c-text-tertiary)]">Searching…</div>
            )}
            {!loading && flat.length === 0 && (
              <div className="px-3 py-3 text-xs text-[var(--c-text-tertiary)]">No matches.</div>
            )}
            {results.skus.length > 0 && (
              <SectionHeader label="SKUs" />
            )}
            {results.skus.map((s, i) => {
              const idx = i;
              return (
                <ResultRow
                  key={`sku-${s.id}`}
                  active={activeIdx === idx}
                  kindLabel="SKU"
                  primary={s.skuCode}
                  secondary={s.isKitParent ? `${s.name} · Kit Parent` : s.name}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => pick(flat[idx])}
                />
              );
            })}
            {results.pos.length > 0 && (
              <SectionHeader label="Purchase Orders" />
            )}
            {results.pos.map((p, i) => {
              const idx = results.skus.length + i;
              const tail = [
                p.lotNumber ? `Lot ${p.lotNumber}` : null,
                p.factoryName,
                p.status.replace(/_/g, " "),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <ResultRow
                  key={`po-${p.id}`}
                  active={activeIdx === idx}
                  kindLabel="PO"
                  primary={`PO ${p.poNumber}`}
                  secondary={tail}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => pick(flat[idx])}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] bg-[var(--c-page-bg)]/40">
      {label}
    </div>
  );
}

function ResultRow({
  active,
  kindLabel,
  primary,
  secondary,
  onMouseEnter,
  onClick,
}: {
  active: boolean;
  kindLabel: string;
  primary: string;
  secondary: string;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 px-3 py-2 transition-colors ${
        active ? "bg-[var(--c-page-bg)]" : "hover:bg-[var(--c-page-bg)]/60"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-text-tertiary)] w-8 shrink-0">
        {kindLabel}
      </span>
      <span className="font-mono text-sm text-[var(--c-text-primary)] shrink-0">{primary}</span>
      <span className="text-xs text-[var(--c-text-secondary)] truncate">{secondary}</span>
    </button>
  );
}
