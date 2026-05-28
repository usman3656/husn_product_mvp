import { CardHeader, EvidenceChip, Pill, Tile } from "@/components/ui";
import { FETCH_INIT } from "@/lib/fetch-init";
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
    const res = await fetch(`${SERVER_API_URL}/api/findings/summary`, FETCH_INIT);
    if (!res.ok) return null;
    return (await res.json()) as FindingsSummary;
  } catch {
    return null;
  }
}

async function fetchFindings(): Promise<Finding[]> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/findings?status=open&limit=20`, FETCH_INIT);
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

const SOURCE_LABEL: Record<string, string> = {
  jira: "Jira",
  slack: "Slack",
  google: "Google",
  microsoft: "Microsoft",
};

export async function DriftCard() {
  const [summary, findings] = await Promise.all([fetchSummary(), fetchFindings()]);
  if (!summary) return null;

  const isClean = summary.open === 0;

  return (
    <Tile tone={isClean ? "neutral" : "danger"} lift>
      <CardHeader
        title="Conflicts across your tools"
        subtitle={
          summary.closed > 0
            ? `${summary.closed} resolved so far`
            : "When two tools disagree on a fact, it shows up here."
        }
        right={
          isClean ? (
            <Pill tone="success">In sync</Pill>
          ) : (
            <Pill tone="danger">
              {summary.open} open
            </Pill>
          )
        }
      />

      {isClean ? (
        <p className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Nothing is in conflict. We compare launch, ship, and deadline dates across
          your tools, and open a conflict here the moment two sources disagree.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </Tile>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const sevTone =
    finding.severity === "high" ? "danger" : finding.severity === "medium" ? "warning" : "neutral";
  const perSource = finding.details?.per_source || {};
  const sources = Object.keys(perSource);
  const isAgent = finding.rule_id.startsWith("AGENT-FINDING-");

  return (
    <li
      className="rounded-[var(--radius-sm)] border p-3.5"
      style={{ borderColor: "var(--danger-line)", background: "var(--panel)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={sevTone}>{finding.severity}</Pill>
          {isAgent && <Pill tone="accent">AI</Pill>}
          <span className="text-[13px] font-medium">{finding.summary}</span>
        </div>
        <span className="shrink-0 text-[11px]" style={{ color: "var(--muted)" }}>
          {timeAgo(finding.opened_at)}
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {sources.map((src) => (
          <div
            key={src}
            className="rounded-[var(--radius-sm)] border p-2.5"
            style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
          >
            <EvidenceChip
              source={SOURCE_LABEL[src] ?? src}
              cite={perSource[src][0]?.artifact_title ?? undefined}
            />
            {perSource[src].map((ev, i) => (
              <div key={`${ev.claim_id}-${i}`} className="mt-2">
                <p className="text-[17px] font-semibold" style={{ letterSpacing: "-0.02em" }}>
                  {ev.value_norm}
                </p>
                <p
                  className="mt-1 truncate text-[11px]"
                  style={{ color: "var(--muted)" }}
                  title={ev.source_anchor.snippet || ev.source_anchor.field_path || ""}
                >
                  {ev.source_anchor.kind === "span"
                    ? ev.source_anchor.snippet
                    : ev.source_anchor.field_path}
                </p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </li>
  );
}
