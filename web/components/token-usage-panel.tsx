"use client";

import { useEffect, useState } from "react";

import { clientFetch } from "@/lib/api";

type Usage = {
  today: { day: string; input: number; output: number; total: number; by_source: Record<string, number> };
  daily: { day: string; input: number; output: number; total: number }[];
};

/** Settings → daily LLM token consumption, summed across the agent renderer,
 * web chat, and the Slack bot. Read-only. */
export function TokenUsagePanel() {
  const [u, setU] = useState<Usage | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    clientFetch("/api/usage/tokens")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setU(d as Usage))
      .catch(() => setErr(true));
  }, []);

  const fmt = (n: number) => n.toLocaleString();

  let value = "…";
  if (err) value = "Unavailable";
  else if (u) value = `${fmt(u.today.total)} tokens`;

  const bySource = u
    ? Object.entries(u.today.by_source)
        .map(([s, n]) => `${s} ${fmt(n)}`)
        .join(" · ")
    : "";

  return (
    <>
      <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
        <div className="min-w-[140px]">
          <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>Today&apos;s usage</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px]" style={{ color: "var(--text-2)" }}>{value}</p>
          {bySource ? (
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>{bySource}</p>
          ) : null}
          <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
            Input + output tokens across the briefing agent, web chat, and the Slack bot (resets daily, UTC).
          </p>
        </div>
      </div>

      {u && u.daily.length > 0 ? (
        <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
          <div className="min-w-[140px]">
            <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>Last 7 days</p>
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            {u.daily.map((d) => (
              <div key={d.day} className="flex items-baseline justify-between gap-4 max-w-[280px]">
                <span className="text-[13px]" style={{ color: "var(--text-2)" }}>{d.day}</span>
                <span className="text-[13px] tabular-nums" style={{ color: "var(--muted)" }}>{fmt(d.total)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
