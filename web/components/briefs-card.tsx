import { FETCH_INIT } from "@/lib/fetch-init";
import { RunButtonClient } from "@/components/briefs-run-button";

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

type Bullet = { text: string; claim_ids: number[] };
type BriefContent = { headline: string; bullets: Bullet[] };

type Brief = {
  id: number;
  project_id: number | null;
  persona: string;
  agent_run_id: number;
  model: string;
  generated_at: string;
  content: BriefContent;
  source_claim_ids: number[];
};

type Status = {
  provider: string;
  model: string;
  last_run_at: string | null;
  last_ok_at: string | null;
  total_runs: number;
  total_briefs: number;
  in_progress: number;
};

async function fetchStatus(): Promise<Status | null> {
  try {
    const r = await fetch(`${SERVER_API_URL}/api/agent/status`, FETCH_INIT);
    if (!r.ok) return null;
    return (await r.json()) as Status;
  } catch {
    return null;
  }
}

async function fetchBriefs(): Promise<Brief[]> {
  try {
    const r = await fetch(`${SERVER_API_URL}/api/agent/briefs?limit=50`, FETCH_INIT);
    if (!r.ok) return [];
    const body = (await r.json()) as { items: Brief[] };
    return body.items;
  } catch {
    return [];
  }
}

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

export async function BriefsCard() {
  const [status, briefs] = await Promise.all([fetchStatus(), fetchBriefs()]);
  if (!status) return null;

  // Latest brief per persona (briefs come back newest-first)
  const latestByPersona = new Map<string, Brief>();
  for (const b of briefs) {
    if (!latestByPersona.has(b.persona)) latestByPersona.set(b.persona, b);
  }
  const personas = Array.from(latestByPersona.keys());

  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">AI pre-meeting briefs</h2>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
            Step 6 · {status.provider}:{status.model} · last run{" "}
            {timeAgo(status.last_run_at)} · {status.total_briefs} briefs total
            {status.in_progress > 0 ? " · running…" : ""}
          </p>
        </div>
        <RunButton inProgress={status.in_progress > 0} />
      </div>

      {personas.length === 0 ? (
        <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
          No briefs yet — agent runs every 5 min or hit "Run analysis" above.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {personas.map((p) => (
            <PersonaBrief key={p} brief={latestByPersona.get(p)!} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunButton({ inProgress }: { inProgress: boolean }) {
  return <RunButtonClient inProgress={inProgress} />;
}

function PersonaBrief({ brief }: { brief: Brief }) {
  const ago = timeAgo(brief.generated_at);
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
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide"
            style={{ background: "#6f7bff22", color: "#a5b4fc" }}
          >
            {brief.persona}
          </span>
          <span className="truncate font-medium">{brief.content.headline}</span>
        </span>
        <span className="shrink-0 pl-2 text-[10px]" style={{ color: "var(--muted)" }}>
          {ago}
        </span>
      </summary>
      <ul className="border-t px-3 py-2 space-y-1.5" style={{ borderColor: "var(--border)" }}>
        {brief.content.bullets.map((b, i) => (
          <li key={i} className="text-[11px] leading-relaxed">
            <span>{b.text}</span>{" "}
            <span
              className="font-mono text-[10px]"
              style={{ color: "var(--muted)" }}
              title={`Cites claim ${b.claim_ids.join(", ")}`}
            >
              [claim {b.claim_ids.join(", ")}]
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
