import Link from "next/link";

/** Sticky, minimal top bar present on every screen. Wordmark + a few pills. */
export function TopBar() {
  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--bg) 82%, transparent)",
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-1.5" aria-label="husn.ai home">
          <span className="text-[17px] font-semibold tracking-tight">husn</span>
          <span className="text-[17px] font-semibold tracking-tight" style={{ color: "var(--accent)" }}>
            .ai
          </span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1.5">
          <NavPill href="/chat">Ask Husn</NavPill>
          <NavPill href="/connections">Connections</NavPill>
          <a
            href="https://husn.io"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors duration-150"
            style={{ color: "var(--muted)" }}
          >
            husn.io
            <span aria-hidden style={{ opacity: 0.6 }}>↗</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

function NavPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 hover:bg-[var(--panel-2)]"
      style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--panel)" }}
    >
      {children}
    </Link>
  );
}
