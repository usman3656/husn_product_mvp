"use client";

import { useEffect, useState } from "react";

import { EmptyState, LoadingState, OfflineState, Pill, Tile } from "@/components/ui";

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type ConnectionRow = {
  id: number;
  source: "slack" | "jira" | "google" | string;
  account_id: string;
  account_label: string | null;
  scopes: string | null;
  created_at: string;
  updated_at: string;
  token_expires_at: string | null;
  token_status: "ok" | "expiring-soon" | "expired" | "expired-no-refresh";
  seconds_until_expiry: number | null;
  has_refresh_token: boolean;
  last_raw_fetched_at: string | null;
  raw_artifact_count: number;
  artifact_count: number;
  scope_count: number;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const SOURCE_LABEL: Record<string, string> = {
  slack: "Slack",
  jira: "Jira",
  google: "Google",
  microsoft: "Microsoft",
};

type Tone = "success" | "warning" | "danger";
const STATUS: Record<string, { tone: Tone; label: string }> = {
  ok: { tone: "success", label: "Healthy" },
  "expiring-soon": { tone: "warning", label: "Expiring soon" },
  expired: { tone: "danger", label: "Expired" },
  "expired-no-refresh": { tone: "danger", label: "Reconnect needed" },
};

export function ConnectionsList() {
  const [items, setItems] = useState<ConnectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function refresh() {
    try {
      const r = await fetch(`${BROWSER_API_URL}/api/connections`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { items: ConnectionRow[] };
      setItems(body.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function disconnect(id: number, label: string) {
    if (!confirm(`Disconnect ${label}? Past data is kept but new syncs will stop.`)) {
      return;
    }
    setBusy(id);
    try {
      const r = await fetch(`${BROWSER_API_URL}/api/connections/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "disconnect failed");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return <OfflineState />;
  }
  if (items === null) {
    return <LoadingState label="Loading connections" />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No connections yet"
        hint="Connect a tool from the dashboard to start watching it for conflicts."
      />
    );
  }

  return (
    <ul className="space-y-4">
      {items.map((c) => {
        const st = STATUS[c.token_status] ?? STATUS.ok;
        return (
          <li key={c.id}>
            <Tile lift>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold">
                    {SOURCE_LABEL[c.source] ?? c.source}
                  </h2>
                  <p className="mt-0.5 truncate text-[12px]" style={{ color: "var(--muted)" }}>
                    {c.account_label || c.account_id} · connected {timeAgo(c.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={st.tone}>{st.label}</Pill>
                  <button
                    onClick={() =>
                      disconnect(c.id, c.account_label || `${c.source} #${c.id}`)
                    }
                    disabled={busy === c.id}
                    className="rounded-full border px-3 py-1 text-[12px] font-medium transition-colors duration-150 disabled:opacity-50"
                    style={{
                      borderColor: "var(--danger-line)",
                      color: "var(--danger-ink)",
                      background: "var(--danger-soft)",
                    }}
                  >
                    {busy === c.id ? "…" : "Disconnect"}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <MiniStat label="Items synced" value={c.artifact_count.toLocaleString()} />
                <MiniStat label="Scopes" value={c.scope_count.toString()} />
                <MiniStat label="Last sync" value={timeAgo(c.last_raw_fetched_at)} />
                <MiniStat
                  label="Access"
                  value={
                    c.token_expires_at
                      ? c.seconds_until_expiry !== null && c.seconds_until_expiry > 0
                        ? `${Math.floor(c.seconds_until_expiry / 60)}m left`
                        : "expired"
                      : "no expiry"
                  }
                />
              </div>

              {c.token_status.startsWith("expired") && (
                <p className="mt-3 text-[12px]" style={{ color: "var(--danger-ink)" }}>
                  {c.has_refresh_token
                    ? "Access expired. It will refresh on the next sync, no action needed."
                    : "Access cannot be refreshed. Disconnect and reconnect to fix."}
                </p>
              )}
            </Tile>
          </li>
        );
      })}
    </ul>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-[var(--radius-sm)] border px-3 py-2.5"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
    >
      <p className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="mt-0.5 text-[15px] font-semibold">{value}</p>
    </div>
  );
}
