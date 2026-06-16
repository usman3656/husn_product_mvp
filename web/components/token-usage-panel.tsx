"use client";

import { useEffect, useState } from "react";

import { clientFetch } from "@/lib/api";

type Usage = {
  today: { day: string; total: number; by_source: Record<string, number> };
  daily: { day: string; total: number }[];
};

type Limits = {
  limits: { "retry-after"?: string; rate_limited?: boolean; updated_at?: string } | null;
};

const fmt = (n: number) => n.toLocaleString();

/** Settings → tokens used. Just the number: how many LLM tokens Husn has spent
 * (Groq/whichever provider), today and over the week. Polls every 20s. A small
 * badge appears only if the provider is rate-limited *right now*. */
export function TokenUsagePanel() {
  const [u, setU] = useState<Usage | null>(null);
  const [lim, setLim] = useState<Limits | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [ur, lr] = await Promise.all([
          clientFetch("/api/usage/tokens"),
          clientFetch("/api/usage/limits"),
        ]);
        if (!alive) return;
        if (ur.ok) setU((await ur.json()) as Usage);
        else setErr(true);
        if (lr.ok) setLim((await lr.json()) as Limits);
      } catch {
        if (alive) setErr(true);
      }
    }
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const weekTotal = u ? u.daily.reduce((s, d) => s + d.total, 0) : 0;
  const today = u?.today.total ?? 0;

  // Only treat the provider as rate-limited if the snapshot is FRESH (≤3 min);
  // a stale "rate-limited 16h ago" is meaningless and was just confusing.
  const L = lim?.limits ?? null;
  const fresh = L?.updated_at ? Date.now() - new Date(L.updated_at).getTime() < 180_000 : false;
  const limitedNow = fresh && !!L?.rate_limited;

  return (
    <>
      <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
        <div className="min-w-[140px]">
          <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>Tokens used</p>
        </div>
        <div className="flex-1 min-w-0">
          {!u ? (
            <p className="text-[14px]" style={{ color: "var(--muted)" }}>{err ? "Unavailable" : "…"}</p>
          ) : (
            <>
              <p className="text-[15px]" style={{ color: "var(--text)" }}>
                <span style={{ fontWeight: 600 }}>{fmt(weekTotal)}</span> in the last 7 days
                <span style={{ color: "var(--muted)" }}> · {fmt(today)} today</span>
              </p>
              {Object.keys(u.today.by_source).length ? (
                <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
                  today: {Object.entries(u.today.by_source).map(([s, n]) => `${s} ${fmt(n)}`).join(" · ")}
                </p>
              ) : null}
              {limitedNow ? (
                <p className="mt-1.5 text-[12.5px] font-medium" style={{ color: "var(--danger-ink)" }}>
                  ⚠️ Provider rate-limited right now{L?.["retry-after"] ? ` — retry in ${L["retry-after"]}s` : ""}
                </p>
              ) : null}
              <p className="mt-1.5 text-[12px]" style={{ color: "var(--muted)" }}>
                LLM tokens (input + output) across the briefing agent, web chat, and Slack bot.
                Updates live; today resets at 00:00 UTC.
              </p>
            </>
          )}
        </div>
      </div>

      {u && u.daily.length > 0 ? (
        <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
          <div className="min-w-[140px]">
            <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>By day</p>
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
