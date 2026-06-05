"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: React.ReactNode; shortcut?: string };

/* Hairline glyphs. Calm, monoline. No emoji. No colored icons. */
const I = {
  briefing: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M8 10h8M8 14h8M8 18h5" />
    </svg>
  ),
  ask: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4 3v-3H6.5A2.5 2.5 0 0 1 4 14.5v-8Z" />
      <path d="M9 9.5h.01M12 9.5h.01M15 9.5h.01" />
    </svg>
  ),
  explore: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  organization: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M12 7v3M12 10 6 16M12 10l6 6" />
    </svg>
  ),
  connections: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 15 4.5 19.5a3.18 3.18 0 0 1-4.5-4.5L4.5 10.5" transform="translate(2 -1)" />
      <path d="m9.5 14.5 5-5" />
      <path d="m15 9 4.5-4.5a3.18 3.18 0 0 1 4.5 4.5L19.5 13.5" transform="translate(-2 1)" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.5 16.96l.06-.06A1.65 1.65 0 0 0 4.89 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.29l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
};

const PRIMARY: NavItem[] = [
  { href: "/", label: "Briefing", icon: I.briefing, shortcut: "B" },
  { href: "/ask", label: "Ask Husn", icon: I.ask, shortcut: "K" },
  { href: "/explore", label: "Explore", icon: I.explore, shortcut: "E" },
  { href: "/organization", label: "Organization", icon: I.organization, shortcut: "O" },
];

const PLUMBING: NavItem[] = [
  { href: "/connections", label: "Connections", icon: I.connections },
  { href: "/settings", label: "Settings", icon: I.settings },
];

export function SideNav() {
  const pathname = usePathname() || "/";

  // Hide the rail on legal / health pages — those want to feel like documents.
  const STANDALONE = ["/privacy", "/terms", "/subprocessors", "/healthz"];
  if (STANDALONE.some((p) => pathname.startsWith(p))) return null;

  return (
    <aside
      aria-label="Primary"
      className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:flex-col md:border-r"
      style={{
        width: "var(--nav-w)",
        borderColor: "var(--rule)",
        background: "color-mix(in srgb, var(--bg) 92%, transparent)",
        backdropFilter: "saturate(140%) blur(16px)",
      }}
    >
      {/* Workspace mark */}
      <div className="px-5 pt-6 pb-5">
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="husn — home">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-[8px]"
            style={{ background: "var(--text)", color: "var(--bg)" }}
          >
            <span className="text-[13px] font-semibold leading-none" style={{ letterSpacing: "-0.04em" }}>
              h
            </span>
          </span>
          <span className="text-[15px] font-semibold tracking-tight">husn</span>
          <span
            className="ml-auto text-[10.5px] font-medium px-1.5 py-0.5 rounded-full border"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            beta
          </span>
        </Link>
      </div>

      {/* Quick command-bar surrogate */}
      <div className="px-3">
        <Link
          href="/ask"
          className="flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-[13px] transition-colors"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel)",
            color: "var(--muted)",
          }}
        >
          <span aria-hidden style={{ opacity: 0.7 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <span className="flex-1 truncate">Ask Husn anything</span>
          <span
            className="rounded px-1.5 py-0.5 text-[10.5px] font-medium"
            style={{ background: "var(--panel-2)", color: "var(--muted)", border: "1px solid var(--border)" }}
            aria-hidden
          >
            ⌘K
          </span>
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="mt-5 flex-1 overflow-y-auto px-2">
        <ul className="space-y-0.5">
          {PRIMARY.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </ul>

        <div className="mt-6 px-3">
          <p className="husn-eyebrow" style={{ fontSize: 10, letterSpacing: "0.18em" }}>
            Workspace
          </p>
        </div>
        <ul className="mt-2 space-y-0.5">
          {PLUMBING.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div
        className="border-t px-4 py-3"
        style={{ borderColor: "var(--rule)" }}
      >
        <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>
          The intelligence layer for your organization.
        </p>
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <li>
      <Link
        href={item.href}
        className="group flex items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-[13.5px] transition-colors"
        style={{
          background: active ? "var(--panel)" : "transparent",
          color: active ? "var(--text)" : "var(--text-2)",
          border: `1px solid ${active ? "var(--border)" : "transparent"}`,
          fontWeight: active ? 600 : 500,
        }}
      >
        <span
          aria-hidden
          style={{ color: active ? "var(--text)" : "var(--muted)" }}
          className="shrink-0"
        >
          {item.icon}
        </span>
        <span className="flex-1 truncate">{item.label}</span>
        {item.shortcut ? (
          <span
            aria-hidden
            className="text-[10.5px] font-medium"
            style={{ color: "var(--muted-2)" }}
          >
            {item.shortcut}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/** Mobile top bar — collapses the rail into a sticky strip with a drawer toggle.
 *  We keep it intentionally minimal; intelligence work is desktop-first. */
export function MobileBar() {
  return (
    <header
      className="md:hidden sticky top-0 z-30 border-b backdrop-blur"
      style={{
        borderColor: "var(--rule)",
        background: "color-mix(in srgb, var(--bg) 88%, transparent)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="husn — home">
          <span
            aria-hidden
            className="grid h-6 w-6 place-items-center rounded-md"
            style={{ background: "var(--text)", color: "var(--bg)" }}
          >
            <span className="text-[11px] font-semibold leading-none">h</span>
          </span>
          <span className="text-[14px] font-semibold tracking-tight">husn</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Primary">
          {PRIMARY.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-2.5 py-1 text-[12px] font-medium"
              style={{ color: "var(--muted)" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
