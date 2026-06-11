"use client";

import { useEffect, useState } from "react";

import { clientFetch, fetchMe, type Me } from "@/lib/api";

type ConnectionRow = {
  id: number;
  source: "slack" | "jira" | "google" | "microsoft" | string;
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

type FileRow = {
  raw_id: number;
  kind: string;
  external_id: string;
  title: string;
  url: string | null;
  fetched_at: string | null;
  normalized_at: string | null;
  status_label: "read" | "fetched";
  source_status: string | null;
};

type FilesResponse = {
  connection_id: number;
  source: string;
  account_label: string | null;
  totals: { fetched: number; read: number; pending: number };
  items: FileRow[];
  showing: number;
};

const SOURCE_LABEL: Record<string, string> = { slack: "Slack", jira: "Jira", google: "Google", microsoft: "Microsoft" };

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

export function ConnectionsList() {
  const [items, setItems] = useState<ConnectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  // Members get a read-only view: no disconnect, no reset (TENANCY.md D5).
  const isAdmin =
    !me?.auth_required || me?.workspace?.role === "owner" || me?.workspace?.role === "admin";

  async function refresh() {
    try {
      const r = await clientFetch("/api/connections", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { items: ConnectionRow[] };
      setItems(body.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }

  useEffect(() => {
    fetchMe().then(setMe);
    refresh();
  }, []);

  async function disconnect(id: number, label: string) {
    if (!confirm(`Disconnect ${label}? Past data is kept but new syncs will stop.`)) return;
    setBusy(id);
    try {
      const r = await clientFetch(`/api/connections/${id}`, { method: "DELETE" });
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
      <div
        className="rounded-[var(--radius)] border px-4 py-3 text-[13.5px]"
        style={{ borderColor: "var(--warning-line)", background: "var(--warning-soft)", color: "var(--warning-ink)" }}
      >
        Could not load connections. The API may be reachable but slow — try again.
      </div>
    );
  }
  if (items === null) {
    return <p className="text-[14px]" style={{ color: "var(--muted)" }}>Loading connections…</p>;
  }

  const connectedSources = new Set(items.map((c) => c.source));
  const unconnected = ALL_PROVIDERS.filter((p) => !connectedSources.has(p.source));

  return (
    <div className="space-y-8">
      {/* Connect a new tool — admin only */}
      {isAdmin && unconnected.length > 0 ? (
        <section>
          <p className="husn-eyebrow">{items.length === 0 ? "Get started" : "Connect another tool"}</p>
          <h2 className="husn-heading mt-3" style={{ fontSize: 19 }}>
            {items.length === 0 ? "Connect your first source" : "Add a source"}
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed max-w-[60ch]" style={{ color: "var(--muted)" }}>
            Husn reads what your team already writes — Slack threads, Jira issues,
            Google docs, Microsoft files — and turns it into a daily briefing.
            Connect a source below to get started; you can add the rest any time.
          </p>
          <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {unconnected.map((p) => (
              <li key={p.source}>
                <ConnectCard provider={p} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Connected tools list */}
      {items.length > 0 ? (
        <section>
          {isAdmin && unconnected.length > 0 ? (
            <p className="husn-eyebrow mb-3">Connected</p>
          ) : null}
          <ul className="space-y-3">
            {items.map((c) => (
              <li key={c.id}>
                <ConnectionRowCard
                  row={c}
                  onDisconnect={() => disconnect(c.id, c.account_label || `${c.source} #${c.id}`)}
                  busy={busy === c.id}
                  canManage={isAdmin}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : !isAdmin ? (
        <div
          className="rounded-[var(--radius)] border border-dashed px-6 py-10"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}
        >
          <p className="text-[14.5px] font-medium">No connections yet.</p>
          <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
            Your workspace admin connects the tools Husn reads from.
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---- Provider catalog -------------------------------------------------------

type Provider = {
  source: string;
  label: string;
  blurb: string;
  authPath: string;
};

const ALL_PROVIDERS: Provider[] = [
  {
    source: "slack",
    label: "Slack",
    blurb: "The conversations where decisions actually happen.",
    authPath: "/auth/slack/start",
  },
  {
    source: "jira",
    label: "Jira",
    blurb: "Issues, dates, status, ownership.",
    authPath: "/auth/jira/start",
  },
  {
    source: "google",
    label: "Google",
    blurb: "Gmail · Drive · Docs · Sheets.",
    authPath: "/auth/google/start",
  },
  {
    source: "microsoft",
    label: "Microsoft",
    blurb: "Outlook · OneDrive · Office files.",
    authPath: "/auth/microsoft/start",
  },
];

function ConnectCard({ provider }: { provider: Provider }) {
  // Normal browser navigation: the API redirects (302) to the provider's
  // OAuth consent screen, and consent → /auth/<provider>/callback comes
  // back to api.husn.io. XHR / fetch cannot follow OAuth redirects.
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "https://api.husn.io";
  const href = `${apiBase}${provider.authPath}`;
  return (
    <a
      href={href}
      className="block rounded-[var(--radius)] border px-5 py-5 husn-lift"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>
            {provider.label}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
            {provider.blurb}
          </p>
        </div>
        <span
          aria-hidden
          className="shrink-0 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12.5px] font-medium"
          style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
        >
          Connect →
        </span>
      </div>
    </a>
  );
}

function StatusDot({ status }: { status: ConnectionRow["token_status"] }) {
  const color =
    status === "ok" ? "var(--aligned)" :
    status === "expiring-soon" ? "var(--uncertain)" :
    "var(--conflict)";
  const soft =
    status === "ok" ? "var(--aligned-soft)" :
    status === "expiring-soon" ? "var(--uncertain-soft)" :
    "var(--conflict-soft)";
  const label =
    status === "ok" ? "Healthy" :
    status === "expiring-soon" ? "Expiring soon" :
    status === "expired" ? "Expired" : "Reconnect needed";
  return (
    <span className="inline-flex items-center gap-1.5 husn-meta" style={{ color }}>
      <span aria-hidden className="husn-pulse inline-block rounded-full" style={{ background: color, width: 7, height: 7, boxShadow: `0 0 0 4px ${soft}` }} />
      {label}
    </span>
  );
}

function ConnectionRowCard({
  row,
  onDisconnect,
  busy,
  canManage,
}: {
  row: ConnectionRow;
  onDisconnect: () => void;
  busy: boolean;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FilesResponse | null>(null);
  const [filesErr, setFilesErr] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);

  async function ensureFiles() {
    if (files || filesLoading) return;
    setFilesLoading(true);
    try {
      const r = await clientFetch(`/api/connections/${row.id}/files?limit=120`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFiles((await r.json()) as FilesResponse);
      setFilesErr(null);
    } catch (e) {
      setFilesErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setFilesLoading(false);
    }
  }

  function toggle() {
    if (!open) ensureFiles();
    setOpen((o) => !o);
  }

  return (
    <article
      className="rounded-[var(--radius)] border"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="husn-heading" style={{ fontSize: 17 }}>
              {SOURCE_LABEL[row.source] ?? row.source}
            </h3>
            <span aria-hidden style={{ color: "var(--muted-2)" }}>·</span>
            <p className="husn-meta truncate">{row.account_label || row.account_id}</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusDot status={row.token_status} />
            <span className="husn-meta">
              Last sync {timeAgo(row.last_raw_fetched_at)}
            </span>
            <span className="husn-meta">
              {row.artifact_count.toLocaleString()} read · {Math.max(0, row.raw_artifact_count - row.artifact_count).toLocaleString()} pending
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggle}
            className="rounded-full border px-3 py-1 text-[12.5px] font-medium"
            style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
            aria-expanded={open}
          >
            {open ? "Hide files" : "Show files"}
          </button>
          {canManage ? (
            <button
              onClick={onDisconnect}
              disabled={busy}
              className="rounded-full border px-3 py-1 text-[12.5px] font-medium disabled:opacity-50"
              style={{ borderColor: "var(--danger-line)", color: "var(--danger-ink)", background: "var(--danger-soft)" }}
            >
              {busy ? "…" : "Disconnect"}
            </button>
          ) : null}
        </div>
      </div>

      {row.token_status.startsWith("expired") ? (
        <p className="px-5 pb-3 text-[12.5px]" style={{ color: "var(--danger-ink)" }}>
          {row.has_refresh_token
            ? "Access expired. It will refresh on the next sync, no action needed."
            : "Access cannot be refreshed. Disconnect and reconnect to fix."}
        </p>
      ) : null}

      {/* Files panel */}
      {open ? (
        <div className="border-t" style={{ borderColor: "var(--rule)" }}>
          <FilesPanel files={files} loading={filesLoading} err={filesErr} />
        </div>
      ) : null}
    </article>
  );
}

function FilesPanel({
  files,
  loading,
  err,
}: {
  files: FilesResponse | null;
  loading: boolean;
  err: string | null;
}) {
  if (err) {
    return <p className="p-5 text-[13px]" style={{ color: "var(--warning-ink)" }}>Could not load files: {err}</p>;
  }
  if (loading || !files) {
    return <p className="p-5 text-[13px]" style={{ color: "var(--muted)" }}>Loading files…</p>;
  }
  if (files.items.length === 0) {
    return (
      <p className="p-5 text-[13px]" style={{ color: "var(--muted)" }}>
        Nothing has been read from this source yet. The next backfill tick will pick things up.
      </p>
    );
  }
  const { totals } = files;
  return (
    <div>
      <div className="px-5 pt-4 pb-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>Files</p>
        <p className="husn-meta">
          {totals.read.toLocaleString()} read · {totals.fetched.toLocaleString()} fetched
          {totals.pending > 0 ? ` · ${totals.pending.toLocaleString()} pending normalization` : ""}
        </p>
        <p className="husn-meta" style={{ color: "var(--muted-2)" }}>
          Showing the {files.showing} most recent.
        </p>
      </div>
      <ul className="max-h-[420px] overflow-y-auto px-2 pb-3">
        {files.items.map((f) => (
          <li key={f.raw_id}>
            <FileRow f={f} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileRow({ f }: { f: FileRow }) {
  const isRead = f.status_label === "read";
  return (
    <div
      className="flex items-center gap-3 rounded-[8px] px-3 py-2"
      style={{ borderBottom: "1px solid var(--rule)" }}
    >
      <span aria-hidden className="shrink-0 inline-block rounded-full" style={{
        background: isRead ? "var(--aligned)" : "var(--uncertain)",
        width: 8, height: 8,
        boxShadow: `0 0 0 4px ${isRead ? "var(--aligned-soft)" : "var(--uncertain-soft)"}`,
      }} />
      <div className="flex-1 min-w-0">
        <p className="truncate text-[13.5px]" style={{ color: "var(--text)" }} title={f.title}>
          {f.title}
        </p>
        <p className="truncate font-mono text-[10.5px]" style={{ color: "var(--muted-2)" }}>
          {f.kind} · {f.external_id}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11.5px] font-medium" style={{ color: isRead ? "var(--success-ink)" : "var(--warning-ink)" }}>
          {isRead ? "Read" : "Fetched"}
        </p>
        <p className="text-[10.5px]" style={{ color: "var(--muted)" }}>
          {timeAgo(f.fetched_at)}
        </p>
      </div>
      {f.url ? (
        <a
          href={f.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[11.5px]"
          style={{ color: "var(--accent)" }}
          title="Open source"
        >
          ↗
        </a>
      ) : null}
    </div>
  );
}
