"use client";

import { useEffect, useState } from "react";

import { DEMO_MODE } from "@/lib/demo";

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
  jira: "Jira (Atlassian)",
  google: "Google (Gmail + Drive)",
  microsoft: "Microsoft (Outlook + Teams)",
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  ok: { bg: "#22c55e22", fg: "#86efac" },
  "expiring-soon": { bg: "#eab30822", fg: "#fde68a" },
  expired: { bg: "#ef444422", fg: "#fca5a5" },
  "expired-no-refresh": { bg: "#ef444433", fg: "#fca5a5" },
};

// Baked snapshot for the read-only GitHub Pages build — no backend to query.
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
    if (!confirm(`Disconnect ${label}? Historical data is kept but no new syncs will happen.`)) {
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
    return (
      <p className="text-sm" style={{ color: "#fca5a5" }}>
        {error}
      </p>
    );
  }
  if (items === null) {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Loading…
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <div
        className="rounded-lg border p-6 text-sm"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <p style={{ color: "var(--muted)" }}>
          No connections yet. Go back to the dashboard and click "Connect …" on a
          source panel.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((c) => {
        const sty = STATUS_STYLE[c.token_status] ?? STATUS_STYLE.ok;
        return (
          <li
            key={c.id}
            className="rounded-lg border p-5"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <div className="flex items-baseline justify-between">
              <div>
                <h2 className="text-sm font-semibold">{SOURCE_LABEL[c.source] ?? c.source}</h2>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
                  <span>{c.account_label || c.account_id}</span>
                  <span> · connected {timeAgo(c.created_at)}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide"
                  style={{ background: sty.bg, color: sty.fg, borderColor: sty.fg + "55" }}
                >
                  {c.token_status}
                </span>
                {!DEMO_MODE && (
                  <button
                    onClick={() =>
                      disconnect(c.id, c.account_label || `${c.source} #${c.id}`)
                    }
                    disabled={busy === c.id}
                    className="rounded border px-3 py-1 text-[11px] font-medium disabled:opacity-50"
                    style={{
                      borderColor: "#ef444466",
                      color: "#fca5a5",
                      background: "#ef444411",
                    }}
                  >
                    {busy === c.id ? "…" : "Disconnect"}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="raw items" value={c.raw_artifact_count.toString()} />
              <Stat label="artifacts" value={c.artifact_count.toString()} />
              <Stat label="scopes" value={c.scope_count.toString()} />
              <Stat label="last sync" value={timeAgo(c.last_raw_fetched_at)} />
              <Stat
                label="token"
                value={
                  c.token_expires_at
                    ? c.seconds_until_expiry !== null && c.seconds_until_expiry > 0
                      ? `${Math.floor(c.seconds_until_expiry / 60)}m left`
                      : "expired"
                    : "no expiry"
                }
              />
            </div>

            {c.scopes && (
              <p
                className="mt-3 truncate font-mono text-[10px]"
                style={{ color: "var(--muted)" }}
                title={c.scopes}
              >
                ↳ scopes: {c.scopes}
              </p>
            )}
            {c.token_status.startsWith("expired") && (
              <p
                className="mt-2 text-[11px]"
                style={{ color: "#fca5a5" }}
              >
                {c.has_refresh_token
                  ? "Token expired but refresh will run on next API call — no action needed."
                  : "Refresh token missing. Disconnect and reconnect to fix."}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded border px-3 py-2"
      style={{ borderColor: "var(--border)", background: "#0f1218" }}
    >
      <p
        className="text-[10px] uppercase tracking-wide"
        style={{ color: "var(--muted)" }}
      >
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm">{value}</p>
    </div>
  );
}
