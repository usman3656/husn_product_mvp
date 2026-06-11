import { CardHeader, EmptyState, Pill, Tile } from "@/components/ui";
import { serverFetch } from "@/lib/api";
import { DisconnectButton } from "@/components/disconnect-button";

const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type SlackMessage = {
  ts: string | null;
  text: string;
  author_id: string;
  author_name: string;
  thread_ts: string | null;
  reply_count: number | null;
};

type SlackChannel = {
  id: string;
  name: string;
  is_member: boolean;
  is_archived: boolean;
  num_members: number | null;
  topic: string | null;
  purpose: string | null;
  message_count: number;
  messages: SlackMessage[];
};

type Feed = { channels: SlackChannel[]; total_messages: number };
type Status = { connections: { id: number; team_name: string | null; account_label: string | null }[] };

async function fetchFeed(): Promise<Feed> {
  try {
    const res = await serverFetch("/api/slack/feed");
    if (!res.ok) return { channels: [], total_messages: 0 };
    return (await res.json()) as Feed;
  } catch {
    return { channels: [], total_messages: 0 };
  }
}

async function fetchStatus(): Promise<Status> {
  try {
    const res = await serverFetch("/auth/slack/status");
    if (!res.ok) return { connections: [] };
    return (await res.json()) as Status;
  } catch {
    return { connections: [] };
  }
}

function formatTs(ts: string | null): string {
  if (!ts) return "";
  const seconds = Number(ts.split(".")[0]);
  if (!Number.isFinite(seconds)) return "";
  const d = new Date(seconds * 1000);
  return d.toLocaleString();
}

export async function SlackPanel() {
  const [feed, status] = await Promise.all([fetchFeed(), fetchStatus()]);
  const isConnected = status.connections.length > 0;
  const workspaceLabel = status.connections
    .map((c) => c.team_name || c.account_label || `team ${c.id}`)
    .join(", ");

  return (
    <Tile lift>
      <CardHeader
        title="Slack"
        subtitle={
          isConnected
            ? `${workspaceLabel} · ${feed.channels.length} channels · ${feed.total_messages} messages`
            : "Channels and threads"
        }
        right={
          <div className="flex items-center">
            <Pill tone={isConnected ? "success" : "neutral"}>
              {isConnected ? "Connected" : "Not connected"}
            </Pill>
            {isConnected && status.connections[0] && (
              <DisconnectButton
                connectionId={status.connections[0].id}
                label={status.connections[0].team_name || status.connections[0].account_label || "Slack"}
              />
            )}
          </div>
        }
      />

      {!isConnected ? (
        <div className="mt-4">
          <EmptyState
            title="Connect Slack to start"
            hint="Authorize a workspace and invite the app to the channels you want watched."
          >
            <a
              href={`${BROWSER_API_URL}/auth/slack/start`}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium"
              style={{ background: "var(--accent)", color: "var(--on-accent)" }}
            >
              Connect Slack
              <span aria-hidden>→</span>
            </a>
          </EmptyState>
        </div>
      ) : feed.channels.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No channels yet"
            hint="Invite the app to a channel in Slack, then run a backfill to pull messages."
          />
        </div>
      ) : (
        <ChannelList channels={feed.channels} />
      )}
    </Tile>
  );
}

function ChannelList({ channels }: { channels: SlackChannel[] }) {
  const hasAnyMember = channels.some((c) => c.is_member);
  return (
    <div className="mt-4 space-y-2">
      {!hasAnyMember && (
        <div
          className="rounded-[var(--radius-sm)] border p-3 text-[12px] leading-relaxed"
          style={{ borderColor: "var(--warning-line)", background: "var(--warning-soft)", color: "var(--warning-ink)" }}
        >
          The app is not in any of these channels yet. In Slack, invite it to a channel,
          then run a backfill to pull messages.
        </div>
      )}
      {channels.map((c) => (
        <ChannelRow key={c.id} channel={c} />
      ))}
    </div>
  );
}

function ChannelRow({ channel }: { channel: SlackChannel }) {
  const member = channel.is_member;
  return (
    <details
      className="group rounded-[var(--radius-sm)] border"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[13px]"
        style={{ color: "var(--text)" }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="text-[11px] transition-transform duration-200 group-open:rotate-90"
            style={{ color: "var(--muted)" }}
          >
            ▸
          </span>
          <span className="truncate font-mono text-[12px]">#{channel.name}</span>
          {member ? (
            <Pill tone="success">In channel</Pill>
          ) : (
            <Pill tone="neutral">Not in channel</Pill>
          )}
          {channel.is_archived && <Pill tone="neutral">Archived</Pill>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px]" style={{ color: "var(--muted)" }}>
          <span>{channel.num_members ?? "?"} members</span>
          <span>{channel.message_count} msgs</span>
        </span>
      </summary>
      <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
        {channel.messages.length === 0 ? (
          <p className="py-2 text-[12px]" style={{ color: "var(--muted)" }}>
            {member
              ? "No messages here yet. Send one in Slack and re-run a backfill."
              : "The app cannot read this channel until it is invited."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {channel.messages.map((m) => (
              <li key={m.ts ?? Math.random()} className="text-[12px] leading-relaxed">
                <span className="font-mono text-[11px]" style={{ color: "var(--muted)" }}>
                  {formatTs(m.ts)}
                </span>{" "}
                <span style={{ color: "var(--accent)" }}>{m.author_name}</span>
                <span style={{ color: "var(--muted)" }}>: </span>
                <span>{m.text || <em style={{ color: "var(--muted)" }}>(empty)</em>}</span>
                {m.reply_count ? (
                  <span style={{ color: "var(--muted)" }}> · {m.reply_count} replies</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
