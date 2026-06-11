import { CardHeader, OfflineState, Pill, Tile } from "@/components/ui";
import { serverJson } from "@/lib/api";

type Counts = {
  persons: number;
  person_identities: number;
  projects: number;
  project_sources: number;
  artifacts: number;
  artifact_mentions: number;
  raw_pending_normalization: number;
};

type Summary = {
  counts: Counts;
  last_raw_fetched_at: string | null;
  last_normalized_at: string | null;
};

type ProjectList = {
  projects: {
    id: number;
    name: string;
    slug: string;
    artifact_count: number;
    scopes: { source: string; kind: string; id: string }[];
  }[];
};

async function fetchSummary(): Promise<Summary | null> {
  return serverJson<Summary>("/api/graph/summary");
}

async function fetchProjects(): Promise<ProjectList> {
  return (await serverJson<ProjectList>("/api/graph/projects")) ?? { projects: [] };
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export async function GraphCard() {
  const [summary, projects] = await Promise.all([fetchSummary(), fetchProjects()]);
  if (!summary) {
    return (
      <Tile>
        <CardHeader title="What we pulled from your tools" />
        <div className="mt-4">
          <OfflineState title="We could not reach your data right now" />
        </div>
      </Tile>
    );
  }
  const c = summary.counts;
  const pending = c.raw_pending_normalization;

  return (
    <Tile lift>
      <CardHeader
        title="What we pulled from your tools"
        subtitle={`Synced automatically · last update ${timeAgo(summary.last_raw_fetched_at)}`}
        right={
          pending === 0 ? (
            <Pill tone="success">In sync</Pill>
          ) : (
            <Pill tone="warning">{pending} catching up</Pill>
          )
        }
      />

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <MiniStat label="People" value={c.persons} />
        <MiniStat label="Projects" value={c.projects} />
        <MiniStat label="Items" value={c.artifacts} />
        <MiniStat label="Identities" value={c.person_identities} />
        <MiniStat label="Scopes" value={c.project_sources} />
        <MiniStat label="Mentions" value={c.artifact_mentions} />
      </div>

      {projects.projects.length > 0 && (
        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
            Projects
          </p>
          <ul className="mt-2 space-y-1.5">
            {projects.projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-[var(--radius-sm)] border px-3 py-2 text-[13px]"
                style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
              >
                <span className="truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-[12px]" style={{ color: "var(--muted)" }}>
                  {p.artifact_count} items
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tile>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-[var(--radius-sm)] border px-3 py-2.5"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
    >
      <p className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="mt-0.5 text-[20px] font-semibold" style={{ letterSpacing: "-0.02em" }}>
        {value}
      </p>
    </div>
  );
}
