"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/skus", label: "SKU Audit" },
  { href: "/admin/uploads", label: "Uploads" },
  { href: "/admin/review", label: "Review Inbox" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="border-b border-[var(--c-border)] mb-6">
      <nav className="flex gap-1 -mb-px">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-[var(--c-accent)] text-[var(--c-text-primary)]"
                  : "border-transparent text-[var(--c-text-secondary)] hover:text-[var(--c-text-primary)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
