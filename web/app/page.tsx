import Link from "next/link";

import { EvidenceChip } from "@/components/ui";
import { FETCH_INIT } from "@/lib/fetch-init";

/* ============================================================
   Briefing — the homepage.
   This is not a dashboard. It's a memo. The most consequential
   thing you should know is on top, in plain prose, with the
   evidence that backs it. Then a short list of other things
   that deserve attention. Nothing else.
   ============================================================ */

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

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

type AgentStatus = {
  provider: string;
  model: string;
  last_run_at: string | null;
  last_ok_at: string | null;
  total_runs: number;
  total_briefs: number;
  in_progress: number;
};

async function fetchFindings(): Promise<Finding[]> {
  try {
    const r = await fetch(`${SERVER_API_URL}/api/findings?status=open&limit=24`, FETCH_INIT);
    if (!r.ok) return [];
    const b = (await r.json()) as { items: Finding[] };
    return b.items;
  } catch { return []; }
}

async function fetchStatus(): Promise<AgentStatus | null> {
  try {
    const r = await fetch(`${SERVER_API_URL}/api/agent/status`, FETCH_INIT);
    if (!r.ok) return null;
    return (await r.json()) as AgentStatus;
  } catch { return null; }
}

const SOURCE_LABEL: Record<string, string> = {
  jira: "Jira",
  slack: "Slack",
  google: "Google",
  microsoft: "Microsoft",
  email: "Email",
};

/* Sort by consequence: severity desc, then most recently opened. */
const SEV_WEIGHT: Record<Finding["severity"], number> = { high: 3, medium: 2, low: 1 };
function byConsequence(a: Finding, b: Finding) {
  const s = SEV_WEIGHT[b.severity] - SEV_WEIGHT[a.severity];
  if (s !== 0) return s;
  return Date.parse(b.opened_at) - Date.parse(a.opened_at);
}

/* Editorial labels for each rule — short, human, no jargon. */
function entryKind(rule_id: string): string {
  if (rule_id === "R-DATE-1") return "Date conflict";
  if (rule_id === "R-OWNER-1") return "Ownership gap";
  if (rule_id === "R-STATUS-1") return "Status drift";
  if (rule_id.startsWith("AGENT-FINDING-")) return "Context gap";
  return "Concern";
}

/* Prose-style narration of a finding. The backend's `summary` is short and
 * factual; we wrap it with a frame that reads like a chief-of-staff line. */
function narration(f: Finding): string {
  const sources = Object.keys(f.details?.per_source ?? {});
  const sourceList = sources.map((s) => SOURCE_LABEL[s] ?? s).join(" and ");
  const where = sources.length >= 2 ? ` Two sources disagree — ${sourceList}.` : "";
  return f.summary + where;
}

function todayHeadline(date = new Date()): string {
  const wd = date.toLocaleDateString(undefined, { weekday: "long" });
  const md = date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
  return `${wd}, ${md}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "moments ago";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "moments ago";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "moments ago";
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export default async function Briefing() {
  const [findings, status] = await Promise.all([fetchFindings(), fetchStatus()]);
  const sorted = [...findings].sort(byConsequence);
  const top = sorted[0];
  const rest = sorted.slice(1);
  const count = sorted.length;

  return (
    <main className="mx-auto px-6 lg:px-10 pt-12 pb-24" style={{ maxWidth: "var(--content-w)" }}>
      {/* Editorial header */}
      <header className="husn-rise" style={{ maxWidth: 720 }}>
        <p className="husn-meta">
          {todayHeadline()} · Updated {timeAgo(status?.last_run_at ?? null)}
        </p>
        <h1 className="husn-display mt-4">
          {greeting(count)}
        </h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          {leadIn(count)}
        </p>
      </header>

      {/* Top concern */}
      {top ? (
        <section className="mt-14 husn-rise" style={{ animationDelay: "60ms" }}>
          <TopConcern f={top} />
        </section>
      ) : (
        <section className="mt-14 husn-rise" style={{ animationDelay: "60ms" }}>
          <AllClear />
        </section>
      )}

      {/* Rest */}
      {rest.length > 0 ? (
        <section className="mt-20 husn-rise" style={{ animationDelay: "120ms" }}>
          <div className="flex items-baseline justify-between mb-6 max-w-[var(--reading-w)]">
            <h2 className="husn-title">Also worth knowing</h2>
            <Link
              href="/explore"
              className="text-[13px] font-medium"
              style={{ color: "var(--muted)" }}
            >
              See everything →
            </Link>
          </div>
          <ol className="space-y-2">
            {rest.slice(0, 8).map((f, idx) => (
              <li key={f.id}>
                <EntryRow f={f} index={idx + 2} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Footer note */}
      <footer className="mt-24 pt-6 border-t" style={{ borderColor: "var(--rule)" }}>
        <p className="husn-meta">
          Briefing is generated by Husn from the activity in your connected tools.{" "}
          <Link href="/ask" style={{ color: "var(--accent)" }} className="font-medium">
            Ask a question
          </Link>{" "}
          to dig in.
        </p>
      </footer>
    </main>
  );
}

/* ---------- Pieces ---------- */

function greeting(count: number): string {
  if (count === 0) return "The week looks unobstructed.";
  if (count === 1) return "One thing deserves your attention.";
  if (count <= 3) return `${spelled(count)} things deserve your attention.`;
  return `${spelled(count)} things deserve your attention. The most consequential is below.`;
}

function leadIn(count: number): string {
  if (count === 0) {
    return "No conflicts, no ownership gaps, no status drift across your tools right now. Husn keeps watching — you'll see a note here the moment something needs you.";
  }
  if (count === 1) {
    return "Husn read across your tools and found one signal worth raising. Evidence is attached. You can resolve it from here.";
  }
  return "Ranked by consequence — not recency. Each item is sourced from your tools, with evidence you can verify in a glance.";
}

function spelled(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);
}

function TopConcern({ f }: { f: Finding }) {
  const sources = Object.keys(f.details?.per_source ?? {});
  return (
    <article
      className="rounded-[var(--radius-xl)] border p-10 lg:p-14"
      style={{
        borderColor: "var(--border)",
        background: "var(--panel)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      <div className="flex items-center gap-3">
        <SeverityMark severity={f.severity} />
        <p className="husn-eyebrow">
          The top concern · {entryKind(f.rule_id)}
        </p>
      </div>

      <h2 className="husn-title mt-6" style={{ fontSize: 36, lineHeight: 1.15, maxWidth: "26ch" }}>
        {f.summary}
      </h2>

      <p className="husn-prose mt-5 max-w-[62ch]">
        {longNarration(f)}
      </p>

      {sources.length > 0 ? (
        <div className="mt-7 flex flex-wrap items-center gap-2">
          {sources.flatMap((src) =>
            (f.details?.per_source[src] ?? []).slice(0, 2).map((ev, i) => (
              <EvidenceChip
                key={`${src}-${i}-${ev.claim_id}`}
                source={SOURCE_LABEL[src] ?? src}
                cite={ev.artifact_title ?? `#${ev.artifact_id}`}
                title={ev.source_anchor.snippet ?? ev.source_anchor.field_path ?? undefined}
              />
            )),
          )}
        </div>
      ) : null}

      <div className="mt-9 flex flex-wrap items-center gap-2.5">
        <ActionButton href={`/investigations/${f.id}`} primary>
          Open investigation
        </ActionButton>
        {f.rule_id === "R-OWNER-1" ? (
          <ActionButton href={`/investigations/${f.id}?action=reach-out`}>
            Reach out
          </ActionButton>
        ) : (
          <ActionButton href={`/investigations/${f.id}?action=ask`}>
            Ask for an update
          </ActionButton>
        )}
        <ActionButton href={`/investigations/${f.id}?action=collect`} muted>
          Collect missing information
        </ActionButton>
      </div>
    </article>
  );
}

function longNarration(f: Finding): string {
  const sources = Object.keys(f.details?.per_source ?? {});
  const distinct = f.details?.distinct_values ?? [];
  const opened = timeAgo(f.opened_at);

  if (f.rule_id === "R-DATE-1" && distinct.length >= 2 && sources.length >= 2) {
    return `${SOURCE_LABEL[sources[0]] ?? sources[0]} commits to ${distinct[0]}. ${SOURCE_LABEL[sources[1]] ?? sources[1]} cites ${distinct[1]}. No one has reconciled the difference since this was opened ${opened}.`;
  }
  if (f.rule_id === "R-STATUS-1" && distinct.length >= 2 && sources.length >= 2) {
    return `${SOURCE_LABEL[sources[0]] ?? sources[0]} reports "${distinct[0]}". ${SOURCE_LABEL[sources[1]] ?? sources[1]} reports "${distinct[1]}". Last reconciled ${opened}.`;
  }
  if (f.rule_id === "R-OWNER-1") {
    return `Ownership has not been confirmed since this was opened ${opened}. Decisions made downstream are riding on an assumption that may not hold.`;
  }
  if (f.rule_id.startsWith("AGENT-FINDING-")) {
    return `A pattern in the activity over the last few days suggests something is being missed. Husn surfaced this ${opened}; the evidence is collected below.`;
  }
  return `Opened ${opened}. The evidence is collected below — verify, then resolve.`;
}

function SeverityMark({ severity }: { severity: Finding["severity"] }) {
  const map = {
    high: { ring: "var(--danger-line)", fill: "var(--danger)", label: "high" },
    medium: { ring: "var(--warning-line)", fill: "var(--warning)", label: "elevated" },
    low: { ring: "var(--border-strong)", fill: "var(--muted)", label: "low" },
  } as const;
  const s = map[severity];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
      style={{ borderColor: s.ring, background: "var(--panel-2)" }}
    >
      <span aria-hidden style={{ background: s.fill, width: 6, height: 6, borderRadius: 999, display: "inline-block" }} />
      <span className="text-[11px] font-medium" style={{ color: s.fill, letterSpacing: 0.04, textTransform: "uppercase" }}>
        {s.label}
      </span>
    </span>
  );
}

function EntryRow({ f, index }: { f: Finding; index: number }) {
  const sources = Object.keys(f.details?.per_source ?? {});
  return (
    <Link
      href={`/investigations/${f.id}`}
      className="group block rounded-[var(--radius)] border px-6 py-5 husn-lift"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-start gap-5">
        <span
          className="shrink-0 tabular text-[13px] font-medium pt-1"
          style={{ color: "var(--muted-2)", width: 22 }}
          aria-hidden
        >
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>
              {entryKind(f.rule_id)}
            </p>
            <span aria-hidden style={{ color: "var(--muted-2)" }}>·</span>
            <p className="husn-meta">Opened {timeAgo(f.opened_at)}</p>
            <SeverityMark severity={f.severity} />
          </div>
          <h3
            className="husn-heading mt-2.5"
            style={{ color: "var(--text)", fontSize: 18 }}
          >
            {f.summary}
          </h3>
          <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--text-2)", maxWidth: "60ch" }}>
            {narration(f)}
          </p>
          {sources.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {sources.slice(0, 4).map((src) => (
                <EvidenceChip
                  key={src}
                  source={SOURCE_LABEL[src] ?? src}
                  cite={f.details?.per_source[src]?.[0]?.artifact_title ?? undefined}
                />
              ))}
            </div>
          ) : null}
        </div>
        <span
          aria-hidden
          className="shrink-0 self-center text-[15px] transition-transform group-hover:translate-x-0.5"
          style={{ color: "var(--muted)" }}
        >
          →
        </span>
      </div>
    </Link>
  );
}

function AllClear() {
  return (
    <article
      className="rounded-[var(--radius-xl)] border p-12 lg:p-16"
      style={{
        borderColor: "var(--border)",
        background: "var(--panel)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      <p className="husn-eyebrow">All clear</p>
      <h2 className="husn-title mt-4" style={{ fontSize: 36, lineHeight: 1.15, maxWidth: "22ch" }}>
        Nothing is drifting across your tools right now.
      </h2>
      <p className="husn-prose mt-5 max-w-[60ch]">
        Husn keeps watching. The moment two sources disagree, an owner goes silent,
        or a status quietly shifts — you'll see it here, with the evidence to act on it.
      </p>
      <div className="mt-8 flex flex-wrap gap-2.5">
        <ActionButton href="/ask" primary>
          Ask Husn a question
        </ActionButton>
        <ActionButton href="/organization">
          See the organization
        </ActionButton>
      </div>
    </article>
  );
}

function ActionButton({
  href,
  children,
  primary,
  muted,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
  muted?: boolean;
}) {
  const style: React.CSSProperties = primary
    ? { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }
    : muted
    ? { background: "transparent", color: "var(--muted)", borderColor: "transparent" }
    : { background: "var(--panel)", color: "var(--text)", borderColor: "var(--border-strong)" };
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13.5px] font-medium transition-colors"
      style={style}
    >
      {children}
    </Link>
  );
}
