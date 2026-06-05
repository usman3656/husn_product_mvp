import Link from "next/link";

/**
 * Site-wide footer. Mounted in layout so every screen surfaces the
 * privacy / terms / subprocessors URLs that OAuth provider branding screens
 * point at. Quiet, never demands attention.
 */
export function SiteFooter() {
  return (
    <footer
      className="mt-12 border-t print:hidden"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[12px] sm:px-6">
        <p style={{ color: "var(--muted)" }}>
          © {new Date().getFullYear()} husn.io
        </p>
        <nav className="flex flex-wrap items-center gap-4">
          <Link href="/privacy" style={{ color: "var(--muted)" }}>
            Privacy
          </Link>
          <Link href="/terms" style={{ color: "var(--muted)" }}>
            Terms
          </Link>
          <Link href="/subprocessors" style={{ color: "var(--muted)" }}>
            Sub-processors
          </Link>
          <a
            href="https://husn.io"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--muted)" }}
          >
            husn.io ↗
          </a>
        </nav>
      </div>
    </footer>
  );
}
