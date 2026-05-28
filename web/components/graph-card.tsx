import { FETCH_INIT } from "@/lib/fetch-init";
const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

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
  try {
    const res = await fetch(`${SERVER_API_URL}/api/graph/summary`, FETCH_INIT);
    if (!res.ok) return null;
    return (await res.json()) as Summary;
  } catch {
    return null;
  }
}

async function fetchProjects(): Promise<ProjectList> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/graph/projects`, FETCH_INIT);
    if (!res.ok) return { projects: [] };
    return (await res.json()) as ProjectList;
  } catch {
    return { projects: [] };
  }
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
      <div
        className="rounded-lg border p-5 text-sm"
        style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--muted)" }}
      >
        Graph offline.
      </div>
    );
  }
  const c = summary.counts;
  const pending = c.raw_pending_normalization;

  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Operational graph</h2>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
            Step 2 · auto-sync · last ingest {timeAgo(summary.last_raw_fetched_at)} · last
            normalize {timeAgo(summary.last_normalized_at)}
          </p>
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide"
          style={{
            borderColor: pending === 0 ? "#22c55e55" : "#eab30855",
            color: pending === 0 ? "#86efac" : "#fde68a",
            background: pending === 0 ? "#22c55e11" : "#eab30811",
          }}
        >
          {pending === 0 ? "in sync" : `${pending} pending`}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
        <Stat label="persons" value={c.persons} />
        <Stat label="identities" value={c.person_identities} />
        <Stat label="projects" value={c.projects} />
        <Stat label="scopes" value={c.project_sources} />
        <Stat label="artifacts" value={c.artifacts} />
        <Stat label="mentions" value={c.artifact_mentions} />
      </div>

      {projects.projects.length > 0 && (
        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Projects
          </p>
          <ul className="mt-2 space-y-1.5">
            {projects.projects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded border px-3 py-1.5 text-xs"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono" style={{ color: "var(--muted)" }}>
                    {p.slug}
                  </span>
                  <span>{p.name}</span>
                </span>
                <span className="flex items-center gap-3 text-[11px]" style={{ color: "var(--muted)" }}>
                  <span>{p.artifact_count} artifacts</span>
                  <span>{p.scopes.length} scopes</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded border px-3 py-2"
      style={{ borderColor: "var(--border)", background: "#0f1218" }}
    >
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="mt-0.5 font-mono text-base">{value}</p>
    </div>
  );
}
