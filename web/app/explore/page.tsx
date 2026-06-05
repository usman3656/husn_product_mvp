import Link from "next/link";

import { EvidenceChip } from "@/components/ui";
import { FETCH_INIT } from "@/lib/fetch-init";

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

type Finding = {
  id: number;
  rule_id: string;
  status: "open" | "closed" | "snoozed";
  severity: "low" | "medium" | "high";
  summary: string;
  details: { kind: string; key: string; distinct_values: string[]; per_source: Record<string, unknown[]> } | null;
  opened_at: string;
  closed_at: string | null;
};

async function fetchFindings(status: "open" | "closed" | "all"): Promise<Finding[]> {
  try { const r = await fetch(`${SERVER_API_URL}/api/findings?status=${status}&limit=100`, FETCH_INIT); if (!r.ok) return []; return ((await r.json()) as { items: Finding[] }).items; }
  catch { return []; }
}

const SOURCE_LABEL: Record<string, string> = { jira: "Jira", slack: "Slack", google: "Google", microsoft: "Microsoft", email: "Email" };

const SEV_WEIGHT: Record<Finding["severity"], number> = { high: 3, medium: 2, low: 1 };

function kindLabel(rule_id: string): string {
  if (rule_id === "R-DATE-1") return "Date conflict";
  if (rule_id === "R-OWNER-1") return "Ownership gap";
  if (rule_id === "R-STATUS-1") return "Status drift";
  if (rule_id.startsWith("AGENT-FINDING-")) return "Context gap";
  return "Concern";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = (sp.status === "closed" || sp.status === "all") ? sp.status : "open";
  const findings = await fetchFindings(status);
  const sorted = [...findings].sort((a, b) => {
    const s = SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity];
    return s !== 0 ? s : Date.parse(b.opened_at) - Date.parse(a.opened_at);
  });

  return (
    <main className="mx-auto px-6 lg:px-10 pt-12 pb-24" style={{ maxWidth: "var(--content-w)" }}>
      <header className="husn-rise" style={{ maxWidth: 720 }}>
        <p className="husn-eyebrow">Explore</p>
        <h1 className="husn-display mt-4">Everything Husn has flagged.</h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          The full record. Filter by what's open, what was resolved, or look at the whole archive.
        </p>
      </header>

      <nav className="mt-10 flex items-center gap-2" aria-label="Filter">
        <FilterTab label="Open" href="/explore" active={status === "open"} />
        <FilterTab label="Resolved" href="/explore?status=closed" active={status === "closed"} />
        <FilterTab label="All" href="/explore?status=all" active={status === "all"} />
        <span className="ml-auto husn-meta">
          {sorted.length} {sorted.length === 1 ? "item" : "items"}
        </span>
      </nav>

      <section className="mt-8">
        {sorted.length === 0 ? (
          <div
            className="rounded-[var(--radius)] border border-dashed px-6 py-12 text-center"
            style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}
          >
            <p className="text-[14.5px]" style={{ color: "var(--text)" }}>
              Nothing to show here.
            </p>
            <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
              {status === "open"
                ? "Husn hasn't flagged anything as open."
                : status === "closed"
                ? "No resolved findings yet."
                : "No findings recorded."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {sorted.map((f) => <Row key={f.id} f={f} />)}
          </ul>
        )}
      </section>
    </main>
  );
}

function FilterTab({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className="rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors"
      style={{
        borderColor: active ? "var(--text)" : "var(--border)",
        background: active ? "var(--text)" : "var(--panel)",
        color: active ? "var(--bg)" : "var(--text-2)",
      }}
    >
      {label}
    </Link>
  );
}

function Row({ f }: { f: Finding }) {
  const sources = Object.keys(f.details?.per_source ?? {});
  return (
    <li>
      <Link
        href={`/investigations/${f.id}`}
        className="block rounded-[var(--radius)] border px-6 py-5 husn-lift"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <div className="flex flex-wrap items-baseline gap-2.5">
          <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>{kindLabel(f.rule_id)}</p>
          <span aria-hidden style={{ color: "var(--muted-2)" }}>·</span>
          <p className="husn-meta">{f.status === "closed" ? `Resolved ${timeAgo(f.closed_at)}` : `Opened ${timeAgo(f.opened_at)}`}</p>
          <SevDot severity={f.severity} />
        </div>
        <h3 className="husn-heading mt-2" style={{ fontSize: 18 }}>{f.summary}</h3>
        {sources.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sources.slice(0, 5).map((s) => <EvidenceChip key={s} source={SOURCE_LABEL[s] ?? s} />)}
          </div>
        ) : null}
      </Link>
    </li>
  );
}

function SevDot({ severity }: { severity: Finding["severity"] }) {
  const c = severity === "high" ? "var(--danger)" : severity === "medium" ? "var(--warning)" : "var(--muted)";
  return (
    <span className="inline-flex items-center gap-1 husn-meta" style={{ color: c }}>
      <span aria-hidden style={{ background: c, width: 5, height: 5, borderRadius: 999, display: "inline-block" }} />
      {severity}
    </span>
  );
}
