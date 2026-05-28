import { CardHeader, EvidenceChip, EmptyState, PersonaBrief, Tile } from "@/components/ui";
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
    <Tile lift>
      <CardHeader
        title="Before your meeting"
        subtitle={`Updated ${timeAgo(status.last_run_at)}${status.in_progress > 0 ? " · refreshing" : ""}`}
        right={<RunButtonClient inProgress={status.in_progress > 0} />}
      />

      {personas.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No briefs yet"
            hint="We write a short, sourced read for each role before your meetings. Run one now or wait for the next refresh."
          />
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {personas.map((p) => {
            const brief = latestByPersona.get(p)!;
            return (
              <PersonaBrief
                key={p}
                persona={brief.persona}
                headline={brief.content.headline}
                meta={timeAgo(brief.generated_at)}
              >
                <ul className="space-y-2 text-[12.5px] leading-relaxed">
                  {brief.content.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden style={{ color: "var(--muted)" }}>•</span>
                      <span>
                        {b.text}{" "}
                        {b.claim_ids.length > 0 && (
                          <EvidenceChip source="Source" cite={`#${b.claim_ids.join(", ")}`} tone="accent" />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </PersonaBrief>
            );
          })}
        </div>
      )}
    </Tile>
  );
}
