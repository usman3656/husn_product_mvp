"use client";

import { useMemo, useState } from "react";

/* ============================================================
   WeeklySignal — small, interactive 7-day chart of findings
   opened vs closed. Hover a day to see the breakdown.
   ============================================================ */

export type SignalDay = {
  date: string;       // ISO date (yyyy-mm-dd)
  opened: number;
  closed: number;
  dayLabel: string;   // "Mon", "Tue" …
};

export function WeeklySignal({ days }: { days: SignalDay[] }) {
  const [active, setActive] = useState<number | null>(null);

  const max = useMemo(() => Math.max(1, ...days.map((d) => Math.max(d.opened, d.closed))), [days]);
  const totalOpened = days.reduce((acc, d) => acc + d.opened, 0);
  const totalClosed = days.reduce((acc, d) => acc + d.closed, 0);

  const selected = active != null ? days[active] : null;

  return (
    <div
      className="rounded-[var(--radius-lg)] border p-6"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="husn-eyebrow">This week</p>
          <h3 className="husn-heading mt-2" style={{ fontSize: 22 }}>
            {trendSentence(totalOpened, totalClosed)}
          </h3>
        </div>
        <div className="flex items-center gap-5">
          <Legend swatch="var(--conflict)" label={`${totalOpened} opened`} />
          <Legend swatch="var(--aligned)" label={`${totalClosed} closed`} />
        </div>
      </div>

      {/* Chart */}
      <div
        className="mt-6 grid items-end gap-3"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, height: 160 }}
        onMouseLeave={() => setActive(null)}
      >
        {days.map((d, i) => {
          const oH = (d.opened / max) * 130;
          const cH = (d.closed / max) * 130;
          const isActive = i === active;
          return (
            <div
              key={d.date}
              className="relative flex flex-col items-center justify-end gap-0.5 cursor-pointer"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              tabIndex={0}
              role="button"
              aria-label={`${d.dayLabel}: ${d.opened} opened, ${d.closed} closed`}
            >
              <div className="flex items-end gap-0.5" style={{ height: 140 }}>
                <span
                  className="rounded-t-[3px] transition-all"
                  style={{
                    width: 14,
                    height: Math.max(2, oH),
                    background: "var(--conflict)",
                    opacity: isActive ? 1 : 0.85,
                  }}
                />
                <span
                  className="rounded-t-[3px] transition-all"
                  style={{
                    width: 14,
                    height: Math.max(2, cH),
                    background: "var(--aligned)",
                    opacity: isActive ? 1 : 0.85,
                  }}
                />
              </div>
              <p className="text-[10.5px]" style={{ color: isActive ? "var(--text)" : "var(--muted)" }}>{d.dayLabel}</p>
            </div>
          );
        })}
      </div>

      {/* Detail */}
      <div
        className="mt-5 rounded-[var(--radius-sm)] border p-3"
        style={{ borderColor: "var(--border)", background: "var(--panel-2)", minHeight: 56 }}
      >
        {selected ? (
          <>
            <p className="husn-eyebrow" style={{ fontSize: 10 }}>{selected.dayLabel} · {selected.date}</p>
            <p className="mt-1 text-[14px]" style={{ color: "var(--text)" }}>
              <strong>{selected.opened}</strong> new concern{selected.opened === 1 ? "" : "s"} surfaced,
              {" "}<strong>{selected.closed}</strong> resolved.
            </p>
          </>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>
            Hover a day to see the breakdown.
          </p>
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px]" style={{ color: "var(--muted)" }}>
      <span aria-hidden className="inline-block rounded-sm" style={{ width: 10, height: 10, background: swatch }} />
      {label}
    </span>
  );
}

function trendSentence(opened: number, closed: number): string {
  if (opened === 0 && closed === 0) return "Nothing surfaced or resolved this week.";
  if (closed > opened + 1) return "More resolved than surfaced. Net progress.";
  if (opened > closed + 1) return "More surfaced than resolved. Picture is widening.";
  return "Surfacing and resolving in balance.";
}
