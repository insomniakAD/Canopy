"use client";

import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

const PAGE_TITLES = [
  { href: "/skus", label: "SKU Planning" },
  { href: "/amazon-doi", label: "Amazon DOI" },
  { href: "/containers", label: "Container Planning" },
  { href: "/forecast-accuracy", label: "Forecast Accuracy" },
  { href: "/import", label: "Import Data" },
  { href: "/tiers", label: "Tier Management" },
  { href: "/reports", label: "Leadership Reports" },
  { href: "/admin", label: "Admin" },
  { href: "/settings", label: "Settings" },
  { href: "/", label: "Dashboard" },
];

export function Topbar() {
  const pathname = usePathname();
  const match = PAGE_TITLES.find((p) =>
    p.href === "/" ? pathname === "/" : pathname.startsWith(p.href)
  );
  const title = match?.label ?? "Canopy";

  return (
    <header className="fixed top-0 left-60 right-0 h-14 bg-[var(--c-card-bg)] border-b border-[var(--c-border)] flex items-center justify-between px-8 z-10">
      <h2 className="text-base font-semibold text-[var(--c-text-primary)] tracking-tight">
        {title}
      </h2>
      <div className="flex items-center gap-2">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--c-text-tertiary)] pointer-events-none"
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
            type="text"
            placeholder="Search..."
            className="pl-9 pr-4 py-1.5 text-sm bg-[var(--c-surface)] border border-[var(--c-border)] rounded-lg w-52 focus:outline-none focus:border-[var(--c-accent)] text-[var(--c-text-primary)] placeholder:text-[var(--c-text-tertiary)] transition-colors"
          />
        </div>
        <button
          aria-label="Notifications"
          className="p-2 rounded-lg hover:bg-[var(--c-surface)] transition-colors text-[var(--c-text-secondary)]"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
