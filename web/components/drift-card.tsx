const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

type FindingsSummary = {
  open: number;
  closed: number;
  open_by_rule: Record<string, number>;
  last_open_at: string | null;
};

type PerSourceEvidence = {
  claim_id: number;
  artifact_id: number;
  artifact_kind: string;
  artifact_title: string | null;
  value_norm: string;
  value: string | null;
  confidence: number;
  extractor_id: string;
  source_anchor: {
    kind: "field" | "span";
    artifact_id?: number;
    field_path?: string;
    snippet?: string;
    intent?: string;
  };
};

type Finding = {
  id: number;
  rule_id: string;
  status: "open" | "closed" | "snoozed";
  severity: "low" | "medium" | "high";
  summary: string;
  details: {
    kind: string;
    key: string;
    distinct_values: string[];
    per_source: Record<string, PerSourceEvidence[]>;
  } | null;
  opened_at: string;
  closed_at: string | null;
};

async function fetchSummary(): Promise<FindingsSummary | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/findings/summary`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as FindingsSummary;
  } catch {
    return null;
  }
}

async function fetchFindings(): Promise<Finding[]> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/findings?status=open&limit=20`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { items: Finding[] };
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

const SEVERITY_COLOR: Record<string, string> = {
  low: "#a78bfa",
  medium: "#f59e0b",
  high: "#ef4444",
};

export async function DriftCard() {
  const [summary, findings] = await Promise.all([fetchSummary(), fetchFindings()]);
  if (!summary) return null;

  const isClean = summary.open === 0;

  return (
    <div
      className="rounded-lg border p-5"
      style={{
        borderColor: isClean ? "var(--border)" : "#ef444466",
        background: isClean ? "var(--panel)" : "#1f0f12",
      }}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Drift inbox</h2>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
            Step 4 · {summary.closed} resolved historically ·{" "}
            {summary.last_open_at
              ? `last opened ${timeAgo(summary.last_open_at)}`
              : "no findings yet"}
          </p>
        </div>
        <span
          className="rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide"
          style={{
            borderColor: isClean ? "#22c55e55" : "#ef444466",
            color: isClean ? "#86efac" : "#fca5a5",
            background: isClean ? "#22c55e11" : "#ef444422",
          }}
        >
          {isClean ? "in sync" : `${summary.open} open`}
        </span>
      </div>

      {isClean ? (
        <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
          No active drift. The rule <span className="font-mono">R-DATE-1</span> compares
          date claims across Jira + Slack; when two sources disagree on a launch / ship /
          deadline date, a finding opens here.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const sevColor = SEVERITY_COLOR[finding.severity] || "var(--muted)";
  const perSource = finding.details?.per_source || {};
  const sources = Object.keys(perSource);

  return (
    <li
      className="rounded border p-3 text-[11px]"
      style={{ borderColor: "#ef444444", background: "#1a1216" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
            style={{ background: sevColor + "22", color: sevColor }}
          >
            {finding.rule_id}
          </span>
          {finding.rule_id.startsWith("AGENT-FINDING-") && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide"
              style={{ background: "#6f7bff22", color: "#a5b4fc" }}
              title="Produced by the LLM agent — see Briefs card for the reasoning"
            >
              AI
            </span>
          )}
          <span className="font-medium">{finding.summary}</span>
        </div>
        <span style={{ color: "var(--muted)" }}>{timeAgo(finding.opened_at)}</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {sources.map((src) => (
          <div
            key={src}
            className="rounded border p-2"
            style={{ borderColor: "var(--border)", background: "#0f1218" }}
          >
            <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {src} says
            </p>
            {perSource[src].map((ev, i) => (
              <div key={`${ev.claim_id}-${i}`} className="mt-1">
                <p className="font-mono text-sm">{ev.value_norm}</p>
                <p
                  className="mt-0.5 truncate font-mono text-[10px]"
                  style={{ color: "var(--muted)" }}
                  title={ev.source_anchor.snippet || ev.source_anchor.field_path || ""}
                >
                  ↳ {ev.source_anchor.kind === "span"
                    ? ev.source_anchor.snippet
                    : `field: ${ev.source_anchor.field_path}`}
                </p>
                <p className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                  {ev.artifact_kind} · {ev.artifact_title || `#${ev.artifact_id}`} · conf {ev.confidence.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </li>
  );
}
