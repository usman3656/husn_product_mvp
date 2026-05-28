import { CardHeader, EmptyState, Pill, Tile } from "@/components/ui";
import { FETCH_INIT } from "@/lib/fetch-init";
import { DisconnectButton } from "@/components/disconnect-button";

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
    const res = await fetch(`${SERVER_API_URL}/api/artifacts?source=${source}&limit=25`, FETCH_INIT);
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
    const res = await fetch(`${SERVER_API_URL}/auth/jira/status`, FETCH_INIT);
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
    const res = await fetch(`${SERVER_API_URL}/auth/slack/status`, FETCH_INIT);
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

  const sub =
    sourceKey === "jira" && isConnected
      ? jiraStatus.connections.map((c) => c.account_label || c.site_url || `site ${c.id}`).join(", ")
      : "Issues and epics";

  return (
    <Tile lift>
      <CardHeader
        title={label}
        subtitle={sub}
        right={
          <div className="flex items-center">
            <Pill tone={isConnected ? "success" : "neutral"}>
              {isConnected ? `Connected · ${items.length}` : "Not connected"}
            </Pill>
            {sourceKey === "jira" && isConnected && jiraStatus.connections[0] && (
              <DisconnectButton
                connectionId={jiraStatus.connections[0].id}
                label={
                  jiraStatus.connections[0].account_label ||
                  jiraStatus.connections[0].site_url ||
                  "Jira"
                }
              />
            )}
          </div>
        }
      />

      {sourceKey === "jira" ? (
        <JiraBody items={items} isConnected={isConnected} />
      ) : (
        <div className="mt-4">
          <EmptyState title="Not connected" hint="Authorize this source to start watching it." />
        </div>
      )}
    </Tile>
  );
}

function JiraBody({ items, isConnected }: { items: Artifact[]; isConnected: boolean }) {
  if (!isConnected) {
    return (
      <div className="mt-4">
        <EmptyState
          title="Connect Jira to start"
          hint="Authorize a Jira site and we will start watching its issues and epics."
        >
          <a
            href={`${BROWSER_API_URL}/auth/jira/start`}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium"
            style={{ background: "var(--accent)", color: "var(--on-accent)" }}
          >
            Connect Jira
            <span aria-hidden>→</span>
          </a>
        </EmptyState>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState title="No items yet" hint="Run a backfill and Jira issues will appear here." />
      </div>
    );
  }

  return (
    <ul className="mt-4 space-y-1.5">
      {items.map((a) => (
        <li
          key={a.id}
          className="flex items-baseline justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-[13px]"
          style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
        >
          <span className="font-mono text-[12px]" style={{ color: "var(--muted)" }}>
            {a.kind === "issue" ? (a.summary.key as string) : "·"}
          </span>
          <span className="flex-1 truncate">
            {(a.summary.summary as string) || (a.summary.name as string) || a.external_id}
          </span>
          {a.summary.status ? <Pill tone="neutral">{a.summary.status as string}</Pill> : null}
        </li>
      ))}
    </ul>
  );
}
