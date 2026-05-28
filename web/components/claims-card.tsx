import { CardHeader, EmptyState, EvidenceChip, Pill, Tile } from "@/components/ui";
import { FETCH_INIT } from "@/lib/fetch-init";
const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

type ClaimsSummary = {
  total: number;
  pending_artifacts: number;
  by_kind: Record<string, number>;
  last_extracted_at: string | null;
};

type Anchor =
  | { kind: "field"; artifact_id: number; field_path: string }
  | {
      kind: "span";
      artifact_id: number;
      char_start: number;
      char_end: number;
      snippet: string;
      intent?: string;
      pattern?: string;
    };

type Claim = {
  id: number;
  kind: string;
  key: string;
  value: string | null;
  value_norm: string | null;
  confidence: number;
  extractor_id: string;
  extracted_at: string;
  source_anchor: Anchor;
  artifact: {
    id: number;
    source: string;
    kind: string;
    title: string | null;
    body: string | null;
    url: string | null;
    occurred_at: string | null;
    external_id: string;
  };
};

async function fetchSummary(): Promise<ClaimsSummary | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/claims/summary`, FETCH_INIT);
    if (!res.ok) return null;
    return (await res.json()) as ClaimsSummary;
  } catch {
    return null;
  }
}

async function fetchClaims(): Promise<Claim[]> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/claims?limit=40`, FETCH_INIT);
    if (!res.ok) return [];
    const body = (await res.json()) as { items: Claim[] };
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

export async function ClaimsCard() {
  const [summary, claims] = await Promise.all([fetchSummary(), fetchClaims()]);
  if (!summary) {
    return null;
  }
  const kinds = Object.entries(summary.by_kind).sort((a, b) => b[1] - a[1]);

  return (
    <Tile lift>
      <CardHeader
        title="Facts we pulled from your tools"
        subtitle={`Updated ${timeAgo(summary.last_extracted_at)}`}
        right={
          <div className="flex flex-wrap justify-end gap-1.5">
            {kinds.slice(0, 4).map(([k, n]) => (
              <Pill key={k} tone="neutral">
                {k} {n}
              </Pill>
            ))}
          </div>
        }
      />

      {claims.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No facts yet"
            hint="As your tools sync, the dates, owners, and decisions we find will appear here, each linked to where it came from."
          />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {claims.slice(0, 12).map((c) => (
            <ClaimRow key={c.id} claim={c} />
          ))}
        </ul>
      )}
    </Tile>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  const valueText = claim.value_norm || claim.value || "(empty)";
  const anchor = claim.source_anchor;
  const snippet = anchor.kind === "span" ? anchor.snippet : anchor.field_path;

  return (
    <li
      className="rounded-[var(--radius-sm)] border px-3 py-2.5"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Pill tone="neutral">{claim.kind}</Pill>
          <span className="truncate text-[13px]">{valueText}</span>
        </div>
        <EvidenceChip source={SOURCE_LABEL[claim.artifact.source] ?? claim.artifact.source} />
      </div>
      <p className="mt-1 truncate text-[11px]" style={{ color: "var(--muted)" }} title={snippet}>
        {snippet}
      </p>
    </li>
  );
}
