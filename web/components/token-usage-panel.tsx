"use client";

import { useEffect, useState } from "react";

import { clientFetch } from "@/lib/api";

type Usage = {
  today: { day: string; input: number; output: number; total: number; by_source: Record<string, number> };
  daily: { day: string; input: number; output: number; total: number }[];
};

type Limits = {
  provider: string;
  limits: {
    "x-ratelimit-limit-tokens"?: string;
    "x-ratelimit-remaining-tokens"?: string;
    "x-ratelimit-reset-tokens"?: string;
    "retry-after"?: string;
    rate_limited?: boolean;
    updated_at?: string;
  } | null;
};

const fmt = (n: number) => n.toLocaleString();
const fmtMaybe = (s?: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? fmt(n) : (s ?? "—");
};

function ago(iso?: string): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Settings → live LLM usage. Shows the provider's REAL remaining quota (from
 * its rate-limit response headers, refreshed continuously) plus our own daily
 * token ledger. Polls every 20s. */
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
        if (lr.ok) setLim((await lr.json()) as Limits);
        if (!ur.ok && !lr.ok) setErr(true);
      } catch {
        if (alive) setErr(true);
      }
    }
    load();
    const t = setInterval(load, 20_000); // continuous, dynamic
    return () => { alive = false; clearInterval(t); };
  }, []);

  const L = lim?.limits ?? null;
  const limited = !!L?.rate_limited;

  return (
    <>
      {/* Live provider quota — the real "am I capped" number */}
      <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
        <div className="min-w-[140px]">
          <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>
            Model quota{lim?.provider ? ` (${lim.provider})` : ""}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          {!L ? (
            <p className="text-[14px]" style={{ color: "var(--muted)" }}>
              {err ? "Unavailable" : "No call yet — quota appears after the next model call."}
            </p>
          ) : limited ? (
            <p className="text-[14px] font-medium" style={{ color: "var(--danger-ink)" }}>
              ⚠️ Rate-limited{L["retry-after"] ? ` — retry in ${L["retry-after"]}s` : ""}
            </p>
          ) : (
            <p className="text-[14px]" style={{ color: "var(--text-2)" }}>
              {fmtMaybe(L["x-ratelimit-remaining-tokens"])} / {fmtMaybe(L["x-ratelimit-limit-tokens"])} tokens left
              {L["x-ratelimit-reset-tokens"] ? ` · resets in ${L["x-ratelimit-reset-tokens"]}` : ""}
            </p>
          )}
          <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
            Live from the provider · {L?.updated_at ? `updated ${ago(L.updated_at)}` : "refreshes every 20s"}
          </p>
        </div>
      </div>

      {/* Our own ledger */}
      <div className="flex flex-wrap items-start gap-4 px-5 py-4 husn-rule">
        <div className="min-w-[140px]">
          <p className="text-[13px] font-medium" style={{ color: "var(--text)" }}>Today (recorded)</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px]" style={{ color: "var(--text-2)" }}>
            {u ? `${fmt(u.today.total)} tokens` : err ? "Unavailable" : "…"}
          </p>
          {u && Object.keys(u.today.by_source).length ? (
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
              {Object.entries(u.today.by_source).map(([s, n]) => `${s} ${fmt(n)}`).join(" · ")}
            </p>
          ) : null}
          <p className="mt-1 text-[12px]" style={{ color: "var(--muted)" }}>
            Tokens Husn recorded across the briefing agent, web chat, and Slack bot (resets daily, UTC).
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
