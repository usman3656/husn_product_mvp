"use client";

import { useEffect, useState } from "react";

import { DEMO_MODE } from "@/lib/demo";
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

// Baked snapshot for the read-only GitHub Pages build (no backend to query).
const DEMO_ROWS: ConnectionRow[] = [
  {
    id: 1, source: "jira", account_id: "atlas-team.atlassian.net",
    account_label: "atlas-team.atlassian.net", scopes: "read:jira-work read:jira-user",
    created_at: "2026-05-01T09:00:00Z", updated_at: "2026-05-23T08:00:00Z",
    token_expires_at: "2026-05-23T12:00:00Z", token_status: "ok",
    seconds_until_expiry: 3000, has_refresh_token: true,
    last_raw_fetched_at: "2026-05-23T07:55:00Z", raw_artifact_count: 214,
    artifact_count: 214, scope_count: 2,
  },
  {
    id: 2, source: "slack", account_id: "T0ATLAS", account_label: "Atlas Workspace",
    scopes: "channels:history channels:read users:read",
    created_at: "2026-05-02T09:00:00Z", updated_at: "2026-05-23T08:00:00Z",
    token_expires_at: null, token_status: "ok", seconds_until_expiry: null,
    has_refresh_token: false, last_raw_fetched_at: "2026-05-23T07:58:00Z",
    raw_artifact_count: 1380, artifact_count: 1380, scope_count: 3,
  },
  {
    id: 3, source: "google", account_id: "tpm@atlas.example",
    account_label: "tpm@atlas.example", scopes: "gmail.readonly drive.readonly",
    created_at: "2026-05-05T09:00:00Z", updated_at: "2026-05-23T08:00:00Z",
    token_expires_at: "2026-05-23T12:30:00Z", token_status: "ok",
    seconds_until_expiry: 4200, has_refresh_token: true,
    last_raw_fetched_at: "2026-05-23T07:50:00Z", raw_artifact_count: 642,
    artifact_count: 642, scope_count: 2,
  },
  {
    id: 4, source: "microsoft", account_id: "tpm@atlas.onmicrosoft.com",
    account_label: "tpm@atlas.onmicrosoft.com",
    scopes: "Mail.Read Files.Read.All offline_access",
    created_at: "2026-05-10T09:00:00Z", updated_at: "2026-05-23T08:00:00Z",
    token_expires_at: "2026-05-23T12:15:00Z", token_status: "ok",
    seconds_until_expiry: 3600, has_refresh_token: true,
    last_raw_fetched_at: "2026-05-23T07:45:00Z", raw_artifact_count: 198,
    artifact_count: 198, scope_count: 3,
  },
];

export function ConnectionsList() {
  const [items, setItems] = useState<ConnectionRow[] | null>(
    DEMO_MODE ? DEMO_ROWS : null,
  );
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
    if (DEMO_MODE) return;
    refresh();
  }, []);

  async function disconnect(id: number, label: string) {
    if (DEMO_MODE) return;
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
                  {!DEMO_MODE && (
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
                  )}
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
