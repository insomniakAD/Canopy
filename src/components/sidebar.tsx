"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";

// ---- Nav groups ----

const PURCHASING_ITEMS = [
  { href: "/", label: "Dashboard", icon: "grid" },
  { href: "/skus", label: "SKU Planning", icon: "package" },
  { href: "/amazon-doi", label: "Amazon DOI", icon: "signal" },
  { href: "/containers", label: "Container Planning", icon: "truck" },
  { href: "/forecast-accuracy", label: "Forecast Accuracy", icon: "target" },
];

const DATA_ITEMS = [
  { href: "/import", label: "Import Data", icon: "upload" },
  { href: "/tiers", label: "Tier Management", icon: "layers" },
  { href: "/reports", label: "Leadership Reports", icon: "chart" },
  { href: "/admin", label: "Admin", icon: "shield" },
];

// ---- Icons ----

const ICONS: Record<string, React.ReactNode> = {
  grid: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  upload: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  package: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),
  truck: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  ),
  chart: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  signal: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 10.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125v-9.75zM16.5 6.375c0-.621.504-1.125 1.125-1.125h2.25C20.496 5.25 21 5.754 21 6.375v13.5c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V6.375z" />
    </svg>
  ),
  target: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 17a5 5 0 100-10 5 5 0 000 10z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 13a1 1 0 100-2 1 1 0 000 2z" />
    </svg>
  ),
  layers: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.429 9.75m11.142 0l4.179 2.25-9.75 5.25-9.75-5.25 4.179-2.25" />
    </svg>
  ),
  gear: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  shield: (
    <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.063 2.522-.187 3.762a47.235 47.235 0 01-1.18 6.46 9.75 9.75 0 01-15.265 0 47.244 47.244 0 01-1.18-6.46A47.07 47.07 0 013 12c0-2.292.36-4.504 1.026-6.575a9.75 9.75 0 0115.948 0A20.92 20.92 0 0121 12z" />
    </svg>
  ),
};

// ---- NavItem ----

function NavItem({ href, label, icon }: { href: string; label: string; icon: string }) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive
          ? "bg-[var(--c-sidebar-active)] text-white font-normal"
          : "text-[var(--c-sidebar-text)] hover:bg-[var(--c-sidebar-hover)] hover:text-white font-light"
      }`}
    >
      {ICONS[icon]}
      {label}
    </Link>
  );
}

// ---- NavGroup ----

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-sidebar-text-muted)] px-3 mb-1">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// ---- SidebarSearch ----

function SidebarSearch() {
  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--c-sidebar-text-muted)] px-3 mb-1">
        Search
      </p>
      <div className="px-3 mt-1">
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
            type="text"
            placeholder="Search SKUs, ASINs..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-[var(--c-sidebar-hover)] border border-transparent focus:outline-none focus:border-white/15 text-white placeholder:text-[var(--c-sidebar-text-muted)] font-light"
          />
        </div>
      </div>
    </div>
  );
}

// ---- SidebarThemeToggle ----

function SidebarThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("canopy-theme", next ? "dark" : "light");
  };

  if (!mounted) return <div className="h-9" />;

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-light text-[var(--c-sidebar-text)] hover:bg-[var(--c-sidebar-hover)] hover:text-white transition-colors"
    >
      {dark ? (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ) : (
        <svg className="w-[18px] h-[18px] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      )}
      <span>{dark ? "Light Theme" : "Dark Theme"}</span>
    </button>
  );
}

// ---- UserMenu ----

function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const userName = session?.user?.name ?? "User";
  const initials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-[var(--c-sidebar-hover)] transition-colors text-left"
      >
        <div className="w-7 h-7 rounded-full bg-[var(--c-sidebar-active)] flex items-center justify-center text-xs font-semibold text-white shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white truncate">{userName}</div>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-[var(--c-sidebar-text-muted)] transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-1 bg-[var(--c-card-bg)] border border-[var(--c-border)] rounded-lg shadow-lg overflow-hidden z-50">
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--c-text-primary)] hover:bg-[var(--c-page-bg)] transition-colors"
          >
            <svg className="w-4 h-4 text-[var(--c-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            My Profile
          </Link>
          <div className="border-t border-[var(--c-border)]" />
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-[var(--c-error)] hover:bg-[var(--c-error-bg-light)] transition-colors text-left"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Sidebar ----

export function Sidebar() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin";

  const dataItems = DATA_ITEMS.filter((item) => item.href !== "/admin" || isAdmin);

  return (
    <nav className="fixed left-0 top-0 bottom-0 w-60 bg-[var(--c-sidebar-bg)] flex flex-col z-20">
      {/* Logo lockup */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--c-sidebar-border)]">
        {/* Mark D badge */}
        <div className="w-9 h-9 rounded-lg bg-black/20 flex items-center justify-center shrink-0">
          <svg width="26" height="16" viewBox="0 0 64 40" fill="none">
            <path
              d="M 2 2 L 20 38 L 32 12 L 44 38 L 62 2"
              stroke="white"
              strokeWidth="8"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
          </svg>
        </div>
        {/* WINSOME / PURCHASING */}
        <div className="font-display min-w-0">
          <div className="text-sm font-medium text-white tracking-[0.12em] uppercase leading-tight">
            Winsome
          </div>
          <div className="text-[10px] text-[var(--c-sidebar-text-muted)] tracking-[0.14em] uppercase leading-tight mt-0.5">
            Purchasing
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <NavGroup label="Purchasing">
          {PURCHASING_ITEMS.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </NavGroup>

        <div className="border-t border-[var(--c-sidebar-border)] mx-3 my-1" />

        <NavGroup label="Data Management">
          {dataItems.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
        </NavGroup>

        <div className="border-t border-[var(--c-sidebar-border)] mx-3 my-1" />

        <SidebarSearch />
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--c-sidebar-border)]">
        <div className="px-3 pt-2 pb-1 space-y-0.5">
          <NavItem href="/settings" label="Settings" icon="gear" />
          <SidebarThemeToggle />
        </div>
        <div className="px-3 pb-3">
          <UserMenu />
        </div>
        <div className="px-5 py-2 border-t border-[var(--c-sidebar-border)]">
          <span className="text-[10px] text-[var(--c-sidebar-text-muted)]">v0.5.0-alpha</span>
        </div>
      </div>
    </nav>
  );
}
