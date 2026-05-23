const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";
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
    const res = await fetch(`${SERVER_API_URL}/api/slack/feed`, { cache: "no-store" });
    if (!res.ok) return { channels: [], total_messages: 0 };
    return (await res.json()) as Feed;
  } catch {
    return { channels: [], total_messages: 0 };
  }
}

async function fetchStatus(): Promise<Status> {
  try {
    const res = await fetch(`${SERVER_API_URL}/auth/slack/status`, { cache: "no-store" });
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
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Slack</h2>
          {isConnected && (
            <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
              {workspaceLabel} · {feed.channels.length} channels · {feed.total_messages} messages
            </p>
          )}
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
          style={{
            borderColor: isConnected ? "#22c55e55" : "var(--border)",
            color: isConnected ? "#86efac" : "var(--muted)",
            background: isConnected ? "#22c55e11" : "transparent",
          }}
        >
          {isConnected ? "connected" : "not connected"}
        </span>
      </div>

      {!isConnected ? (
        <NotConnected />
      ) : feed.channels.length === 0 ? (
        <NoChannels />
      ) : (
        <ChannelList channels={feed.channels} />
      )}
    </div>
  );
}

function NotConnected() {
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

function NoChannels() {
  return (
    <div className="mt-4 rounded border border-dashed p-4 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
      No channels yet. Run a backfill:{" "}
      <code className="font-mono">curl -X POST {BROWSER_API_URL}/slack/backfill</code>
    </div>
  );
}

function ChannelList({ channels }: { channels: SlackChannel[] }) {
  const hasAnyMember = channels.some((c) => c.is_member);
  return (
    <div className="mt-4 space-y-2">
      {!hasAnyMember && (
        <div
          className="rounded border p-3 text-[11px]"
          style={{ borderColor: "#eab30855", background: "#eab30811", color: "#fde68a" }}
        >
          ⚠ The bot isn&apos;t in any of these channels yet. In Slack, type{" "}
          <code className="font-mono">/invite @husn.io local dev</code> in a channel, then{" "}
          <code className="font-mono">POST {BROWSER_API_URL}/slack/backfill</code> to pull messages.
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
      className="rounded border"
      style={{ borderColor: "var(--border)", background: "#0f1218" }}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs"
        style={{ color: "var(--text)" }}
      >
        <span className="flex items-center gap-2">
          <span style={{ color: "var(--muted)" }}>▸</span>
          <span className="font-mono">#{channel.name}</span>
          {member ? (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
              style={{ background: "#22c55e22", color: "#86efac" }}
            >
              bot joined
            </span>
          ) : (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
              style={{ background: "#11141b", color: "var(--muted)" }}
            >
              bot not in channel
            </span>
          )}
          {channel.is_archived && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
              style={{ background: "#11141b", color: "var(--muted)" }}
            >
              archived
            </span>
          )}
        </span>
        <span className="flex items-center gap-3" style={{ color: "var(--muted)" }}>
          <span>{channel.num_members ?? "?"} members</span>
          <span>{channel.message_count} msgs</span>
        </span>
      </summary>
      <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
        {channel.messages.length === 0 ? (
          <p className="py-2 text-[11px]" style={{ color: "var(--muted)" }}>
            {member
              ? "No messages ingested yet for this channel. Send one in Slack and re-run backfill."
              : "Bot can't read this channel until invited. /invite the app in Slack."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {channel.messages.map((m) => (
              <li key={m.ts ?? Math.random()} className="text-[11px] leading-relaxed">
                <span className="font-mono" style={{ color: "var(--muted)" }}>
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
