"use client";

import { useEffect, useState } from "react";

import { DEMO_MODE } from "@/lib/demo";

type Upcoming = {
  id: string;
  title: string;
  detail: string;
  tone: "warning" | "danger" | "neutral";
  when: string;
};

// Forecasted Project Atlas items for the read-only snapshot.
const DEMO_UPCOMING: Upcoming[] = [
  {
    id: "u1",
    title: "Regression suite finishes June 8",
    detail: "Only 2 days of buffer before the June 10 launch.",
    tone: "warning",
    when: "in ~10 days",
  },
  {
    id: "u2",
    title: "Security re-scan still pending sign-off",
    detail: "The reviewer asked for a re-scan after the May 15 auth change and has not signed off.",
    tone: "danger",
    when: "blocking",
  },
  {
    id: "u3",
    title: "Finance still planning against June 3",
    detail: "Budget and headcount dates trail the current June 10 target.",
    tone: "warning",
    when: "needs a nudge",
  },
];

const TONE: Record<Upcoming["tone"], { dot: string; ink: string; soft: string; line: string }> = {
  warning: { dot: "var(--warning)", ink: "var(--warning-ink)", soft: "var(--warning-soft)", line: "var(--warning-line)" },
  danger: { dot: "var(--danger)", ink: "var(--danger-ink)", soft: "var(--danger-soft)", line: "var(--danger-line)" },
  neutral: { dot: "var(--muted)", ink: "var(--muted)", soft: "var(--panel-2)", line: "var(--border)" },
};

/**
 * Always-present, collapsible "Upcoming issues" widget pinned bottom-right.
 * Mounted in layout so it persists across all screens. Keyboard accessible,
 * reduced-motion friendly, and stays clear of the chat input on mobile.
 */
export function UpcomingIssues() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Upcoming[]>(DEMO_MODE ? DEMO_UPCOMING : []);

  // Outside demo there is no forecast endpoint wired yet; show empty state.
  useEffect(() => {
    if (DEMO_MODE) return;
    setItems([]);
  }, []);

  // Close on Escape when expanded.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const count = items.length;

  return (
    <div
      className="fixed bottom-4 right-4 z-40 print:hidden"
      style={{ maxWidth: "min(22rem, calc(100vw - 2rem))" }}
    >
      {open ? (
        <section
          aria-label="Upcoming issues"
          className="husn-rise overflow-hidden rounded-[var(--radius)] border"
          style={{
            width: "min(22rem, calc(100vw - 2rem))",
            background: "var(--panel)",
            borderColor: "var(--border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div
            className="flex items-center justify-between gap-2 border-b px-4 py-3"
            style={{ borderColor: "var(--border)" }}
          >
            <h2 className="text-[14px] font-semibold">Upcoming issues</h2>
            <button
              onClick={() => setOpen(false)}
              aria-label="Collapse upcoming issues"
              className="rounded-full px-2 py-1 text-[13px]"
              style={{ color: "var(--muted)" }}
            >
              Hide
            </button>
          </div>

          {count === 0 ? (
            <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--muted)" }}>
              No upcoming issues. You are clear.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto p-2">
              {items.map((it) => {
                const t = TONE[it.tone];
                return (
                  <li
                    key={it.id}
                    className="rounded-[var(--radius-sm)] border p-3"
                    style={{ background: t.soft, borderColor: t.line, marginBottom: 8 }}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: t.dot }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[13px] font-medium">{it.title}</p>
                          <span className="shrink-0 text-[11px] font-medium" style={{ color: t.ink }}>
                            {it.when}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                          {it.detail}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="husn-lift inline-flex items-center gap-2 rounded-full border py-2 pl-4 pr-2.5 text-[13px] font-medium"
          style={{
            background: "var(--panel)",
            borderColor: "var(--border)",
            color: "var(--text)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          Show upcoming issues
          {count > 0 ? (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
              style={{ background: "var(--accent)", color: "var(--on-accent)" }}
            >
              {count}
            </span>
          ) : (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
              style={{ background: "var(--panel-2)", color: "var(--muted)" }}
            >
              0
            </span>
          )}
        </button>
      )}
    </div>
  );
}
