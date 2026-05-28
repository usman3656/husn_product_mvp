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

const KIND_COLOR: Record<string, string> = {
  date: "#60a5fa",
  owner: "#a78bfa",
  status: "#34d399",
  decision: "#f59e0b",
  scope: "#f97316",
  dependency: "#ec4899",
};

export async function ClaimsCard() {
  const [summary, claims] = await Promise.all([fetchSummary(), fetchClaims()]);
  if (!summary) {
    return null;
  }
  const kinds = Object.entries(summary.by_kind).sort((a, b) => b[1] - a[1]);

  return (
    <div
      className="rounded-lg border p-5"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold">Claims</h2>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
            Step 3 · evidence-linked · last run {timeAgo(summary.last_extracted_at)} ·{" "}
            {summary.pending_artifacts} pending
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {kinds.map(([k, n]) => (
            <span
              key={k}
              className="rounded-full border px-2 py-0.5 text-[10px] font-mono"
              style={{
                borderColor: (KIND_COLOR[k] || "var(--border)") + "55",
                color: KIND_COLOR[k] || "var(--muted)",
                background: (KIND_COLOR[k] || "#000") + "11",
              }}
            >
              {k} {n}
            </span>
          ))}
        </div>
      </div>

      {claims.length === 0 ? (
        <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
          No claims yet — extractors run on new artifacts every ~15s.
        </p>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {claims.slice(0, 14).map((c) => (
            <ClaimRow key={c.id} claim={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  const color = KIND_COLOR[claim.kind] || "var(--muted)";
  const valueText = claim.value_norm || claim.value || "(empty)";
  const anchor = claim.source_anchor;
  const snippet = anchor.kind === "span" ? anchor.snippet : `field: ${anchor.field_path}`;

  return (
    <li
      className="rounded border px-3 py-2 text-[11px]"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
            style={{ background: color + "22", color }}
          >
            {claim.kind}
          </span>
          <span className="font-mono" style={{ color: "var(--muted)" }}>
            {claim.key}
          </span>
          <span>= {valueText}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--muted)" }}>
          <span>conf {claim.confidence.toFixed(2)}</span>
          <span>
            {claim.artifact.source}.{claim.artifact.kind}
          </span>
        </div>
      </div>
      <p
        className="mt-1 truncate font-mono text-[10px]"
        style={{ color: "var(--muted)" }}
        title={snippet}
      >
        ↳ {snippet}
      </p>
    </li>
  );
}
