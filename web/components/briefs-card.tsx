import { CardHeader, EmptyState, Tile } from "@/components/ui";
import { serverFetch, serverJson } from "@/lib/api";
import { BriefsTabs } from "@/components/briefs-tabs";
import { RunButtonClient } from "@/components/briefs-run-button";

type Bullet = { text: string; claim_ids: number[] };
type ConflictRendered = { conflict_id: number; text: string; claim_ids: number[] };
type BriefContent = {
  headline: string;
  bullets: Bullet[];
  conflicts_rendered?: ConflictRendered[];
  fallback_used?: boolean;
  prompt_version?: number;
};

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
  return serverJson<Status>("/api/agent/status");
}

async function fetchBriefs(): Promise<Brief[]> {
  try {
    const r = await serverFetch("/api/agent/briefs?limit=50");
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

  return (
    <Tile lift>
      <CardHeader
        title="Before your meeting"
        subtitle={`Updated ${timeAgo(status.last_run_at)}${status.in_progress > 0 ? " · refreshing" : ""}`}
        right={<RunButtonClient inProgress={status.in_progress > 0} />}
      />

      {briefs.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No briefs yet"
            hint="We write a short, sourced read for each role before your meetings. Run one now or wait for the next refresh."
          />
        </div>
      ) : (
        <BriefsTabs briefs={briefs} />
      )}
    </Tile>
  );
}
