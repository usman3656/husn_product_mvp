const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type SourceKey = "slack" | "jira" | "google" | "microsoft";

type Artifact = {
  id: number;
  source: string;
  kind: string;
  external_id: string;
  fetched_at: string;
  summary: Record<string, unknown>;
};

type ListResponse = { count: number; items: Artifact[] };

async function fetchArtifacts(source: SourceKey): Promise<ListResponse> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/artifacts?source=${source}&limit=25`, {
      cache: "no-store",
    });
    if (!res.ok) return { count: 0, items: [] };
    return (await res.json()) as ListResponse;
  } catch {
    return { count: 0, items: [] };
  }
}

type JiraStatus = {
  connections: { id: number; account_label: string | null; site_url: string | null }[];
};

async function fetchJiraStatus(): Promise<JiraStatus> {
  try {
    const res = await fetch(`${SERVER_API_URL}/auth/jira/status`, { cache: "no-store" });
    if (!res.ok) return { connections: [] };
    return (await res.json()) as JiraStatus;
  } catch {
    return { connections: [] };
  }
}

type SlackStatus = {
  connections: { id: number; account_label: string | null; team_name: string | null }[];
};

async function fetchSlackStatus(): Promise<SlackStatus> {
  try {
    const res = await fetch(`${SERVER_API_URL}/auth/slack/status`, { cache: "no-store" });
    if (!res.ok) return { connections: [] };
    return (await res.json()) as SlackStatus;
  } catch {
    return { connections: [] };
  }
}

export async function SourcePanel({
  sourceKey,
  label,
}: {
  sourceKey: SourceKey;
  label: string;
}) {
  const { items } = await fetchArtifacts(sourceKey);
  const jiraStatus = sourceKey === "jira" ? await fetchJiraStatus() : { connections: [] };
  const slackStatus = sourceKey === "slack" ? await fetchSlackStatus() : { connections: [] };
  const isConnected =
    (sourceKey === "jira" && jiraStatus.connections.length > 0) ||
    (sourceKey === "slack" && slackStatus.connections.length > 0);

  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{label}</h2>
          {sourceKey === "jira" && isConnected && (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
              {jiraStatus.connections
                .map((c) => c.account_label || c.site_url || `cloudId ${c.id}`)
                .join(", ")}
            </p>
          )}
          {sourceKey === "slack" && isConnected && (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
              {slackStatus.connections
                .map((c) => c.team_name || c.account_label || `team ${c.id}`)
                .join(", ")}
            </p>
          )}
        </div>
        <SourceBadge sourceKey={sourceKey} connected={isConnected} count={items.length} />
      </div>

      {sourceKey === "jira" ? (
        <JiraBody items={items} isConnected={isConnected} />
      ) : sourceKey === "slack" ? (
        <SlackBody items={items} isConnected={isConnected} />
      ) : (
        <PlaceholderBody sourceKey={sourceKey} />
      )}
    </div>
  );
}

function SourceBadge({
  sourceKey,
  connected,
  count,
}: {
  sourceKey: SourceKey;
  connected: boolean;
  count: number;
}) {
  if (sourceKey !== "jira" && sourceKey !== "slack") {
    return (
      <span
        className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      >
        not connected
      </span>
    );
  }
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
      style={{
        borderColor: connected ? "#22c55e55" : "var(--border)",
        color: connected ? "#86efac" : "var(--muted)",
        background: connected ? "#22c55e11" : "transparent",
      }}
    >
      {connected ? `connected · ${count}` : "not connected"}
    </span>
  );
}

function PlaceholderBody({ sourceKey }: { sourceKey: SourceKey }) {
  return (
    <>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Connect via OAuth to start ingesting artifacts. Source key:{" "}
        <span className="font-mono">{sourceKey}</span>
      </p>
      <div
        className="mt-4 h-24 rounded border border-dashed text-xs"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex h-full items-center justify-center" style={{ color: "var(--muted)" }}>
          No artifacts yet.
        </div>
      </div>
    </>
  );
}

function JiraBody({ items, isConnected }: { items: Artifact[]; isConnected: boolean }) {
  if (!isConnected) {
    return (
      <div className="mt-4 flex items-center justify-between rounded border border-dashed p-4" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Authorize a Jira site to start ingesting.
        </p>
        <a
          href={`${BROWSER_API_URL}/auth/jira/start`}
          className="rounded border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)", background: "#1a1f2c" }}
        >
          Connect Jira →
        </a>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mt-4 flex flex-col items-start gap-2 rounded border border-dashed p-4" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          No artifacts ingested yet. Run a backfill:
        </p>
        <code className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
          curl -X POST {BROWSER_API_URL}/jira/backfill
        </code>
      </div>
    );
  }

  return (
    <ul className="mt-4 space-y-1.5">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex items-baseline justify-between gap-3 rounded border px-3 py-2 text-xs"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="font-mono" style={{ color: "var(--muted)" }}>
            {a.kind === "issue" ? (a.summary.key as string) : "·"}
          </span>
          <span className="flex-1 truncate">
            {(a.summary.summary as string) ||
              (a.summary.name as string) ||
              a.external_id}
          </span>
          {a.summary.status && (
            <span
              className="rounded border px-2 py-0.5 text-[10px]"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              {a.summary.status as string}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SlackBody({ items, isConnected }: { items: Artifact[]; isConnected: boolean }) {
  if (!isConnected) {
    return (
      <div
        className="mt-4 flex items-center justify-between rounded border border-dashed p-4"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Authorize a Slack workspace to start ingesting.
        </p>
        <a
          href={`${BROWSER_API_URL}/auth/slack/start`}
          className="rounded border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--border)", color: "var(--text)", background: "#1a1f2c" }}
        >
          Connect Slack →
        </a>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className="mt-4 flex flex-col items-start gap-2 rounded border border-dashed p-4"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          No artifacts ingested yet. Run a backfill:
        </p>
        <code className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
          curl -X POST {BROWSER_API_URL}/slack/backfill
        </code>
      </div>
    );
  }

  return (
    <ul className="mt-4 space-y-1.5">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex items-baseline justify-between gap-3 rounded border px-3 py-2 text-xs"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="font-mono" style={{ color: "var(--muted)" }}>
            {a.kind === "message"
              ? `#${(a.summary.channel as string) || "?"}`
              : a.kind === "channel"
                ? "#"
                : a.kind === "user"
                  ? "@"
                  : "·"}
          </span>
          <span className="flex-1 truncate">
            {a.kind === "message"
              ? (a.summary.text as string) || "(empty message)"
              : a.kind === "channel"
                ? (a.summary.name as string)
                : a.kind === "user"
                  ? (a.summary.name as string)
                  : a.external_id}
          </span>
          <span
            className="rounded border px-2 py-0.5 text-[10px]"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            {a.kind}
          </span>
        </li>
      ))}
    </ul>
  );
}
