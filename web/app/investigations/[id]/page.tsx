import Link from "next/link";
import { notFound } from "next/navigation";

import { ReachOutButton, type ReachOutContext } from "@/components/reach-out";
import { EvidenceChip } from "@/components/ui";
import { FETCH_INIT } from "@/lib/fetch-init";

/* ============================================================
   Investigation — the file on a single concern.
   Built as a case folder, not a record view: the headline at
   the top, the evidence as quotes, a timeline, related entities,
   and the actions you can take from here.
   ============================================================ */

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

type Evidence = {
  role: string;
  claim_id: number;
  kind: string;
  key: string;
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
    per_source: Record<string, unknown[]>;
  } | null;
  opened_at: string;
  closed_at: string | null;
  claim_group: { id: number; kind: string; key: string; project_id: number | null } | null;
  evidence: Evidence[];
};

async function fetchFinding(id: number): Promise<Finding | null> {
  try {
    const r = await fetch(`${SERVER_API_URL}/api/findings/${id}`, FETCH_INIT);
    if (!r.ok) return null;
    return (await r.json()) as Finding;
  } catch { return null; }
}

const SOURCE_LABEL: Record<string, string> = {
  jira: "Jira", slack: "Slack", google: "Google", microsoft: "Microsoft", email: "Email",
};

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function kindLabel(rule_id: string): string {
  if (rule_id === "R-DATE-1") return "Date conflict";
  if (rule_id === "R-OWNER-1") return "Ownership gap";
  if (rule_id === "R-STATUS-1") return "Status drift";
  if (rule_id.startsWith("AGENT-FINDING-")) return "Context gap";
  return "Concern";
}

function prettyKey(key?: string | null): string {
  if (!key) return "this";
  const last = key.split("/").pop() || key;
  return last.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function reachOutContext(f: Finding): ReachOutContext {
  const sources: string[] = [];
  for (const ev of f.evidence) {
    const src = ev.extractor_id?.split(".")[0];
    if (src && !sources.includes(src)) sources.push(src);
  }
  const sourceList = sources.map((s) => SOURCE_LABEL[s] ?? s).join(" and ");
  const k = prettyKey(f.details?.key);

  if (f.rule_id === "R-DATE-1") {
    return {
      who: "The likely owner",
      why: `${sourceList || "Multiple sources"} are recording different dates. Whoever last touched these is closest to the truth.`,
      about: `${k} conflict`,
      draft: `Hey — quick one. ${sourceList || "Two of our tools"} are showing different dates for ${k.toLowerCase()}. Which should we treat as the source of truth so I can keep downstream plans aligned?`,
      via: sources.includes("slack") ? "slack" : "email",
    };
  }
  if (f.rule_id === "R-STATUS-1") {
    return {
      who: "The likely owner",
      why: `Status is being reported differently across ${sourceList || "tools"}. They have ground truth.`,
      about: `${k} drift`,
      draft: `Hey — saw the status on ${k.toLowerCase()} read differently across ${sourceList || "our tools"}. Where are we actually? Want to make sure the rest of the team is reading the same picture.`,
      via: sources.includes("slack") ? "slack" : "email",
    };
  }
  if (f.rule_id === "R-OWNER-1") {
    return {
      who: "Possible owners",
      why: `Multiple names are showing up across ${sourceList || "tools"}. Worth a single confirmation.`,
      about: `${k} unclear`,
      draft: `Hi — small confirm: who owns ${k.toLowerCase()} right now? I'm seeing a few names and want to point updates at the right person.`,
      via: "slack",
    };
  }
  return {
    who: "The likely owner",
    why: "Husn surfaced uncertainty here and they have the most recent context.",
    about: kindLabel(f.rule_id),
    draft: `Hi — could you give me a quick read on where we are with this? Trying to align before the next planning cycle.`,
    via: "slack",
  };
}

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isFinite(n)) notFound();
  const f = await fetchFinding(n);
  if (!f) notFound();

  // Group evidence by source for the side-by-side view
  const bySource: Record<string, Evidence[]> = {};
  for (const ev of f.evidence) {
    // extractor_id is shape "<source>.<kind>"; if missing, fall back to claim kind
    const src = ev.extractor_id?.split(".")[0] ?? "unknown";
    (bySource[src] ||= []).push(ev);
  }

  return (
    <main className="mx-auto px-6 lg:px-10 pt-12 pb-24" style={{ maxWidth: "var(--content-w)" }}>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium"
        style={{ color: "var(--muted)" }}
      >
        <span aria-hidden>←</span> Briefing
      </Link>

      {/* Hero */}
      <header className="mt-8 max-w-[var(--reading-w)] husn-rise">
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="husn-eyebrow">Investigation · {kindLabel(f.rule_id)}</p>
          <span aria-hidden style={{ color: "var(--muted-2)" }}>·</span>
          <p className="husn-meta">Opened {timeAgo(f.opened_at)}</p>
          <SeverityChip severity={f.severity} />
          <StatusChip status={f.status} />
        </div>
        <h1 className="husn-title mt-4" style={{ fontSize: 38, lineHeight: 1.12, letterSpacing: "-0.024em" }}>
          {f.summary}
        </h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          Here is what each source says, where the disagreement is, and who the
          owners are. Use the actions on the right to move it.
        </p>
      </header>

      {/* Body: two-column. Left = evidence + timeline. Right = actions + related. */}
      <div className="mt-14 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-12 lg:gap-16">
        <div>
          {/* Side-by-side evidence */}
          <section>
            <p className="husn-eyebrow">Evidence</p>
            <h2 className="husn-heading mt-3">What each source says</h2>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.keys(bySource).map((src) => (
                <EvidencePane key={src} source={src} items={bySource[src]} />
              ))}
              {Object.keys(bySource).length === 0 ? (
                <p className="text-[14px]" style={{ color: "var(--muted)" }}>
                  No evidence was attached to this finding yet.
                </p>
              ) : null}
            </div>
          </section>

          {/* Timeline */}
          <section className="mt-14">
            <p className="husn-eyebrow">Timeline</p>
            <h2 className="husn-heading mt-3">What happened, in order</h2>
            <ol className="mt-6 relative" style={{ borderLeft: "1px solid var(--rule)" }}>
              <TimelineRow
                when={timeAgo(f.opened_at)}
                title="Husn opened this investigation"
                body={`Detected by rule ${f.rule_id} after observing disagreement across sources.`}
                first
              />
              {f.evidence.slice(0, 5).map((ev) => (
                <TimelineRow
                  key={ev.claim_id}
                  when={`Claim #${ev.claim_id}`}
                  title={`${SOURCE_LABEL[ev.extractor_id?.split(".")[0] ?? ""] ?? ev.extractor_id} recorded "${ev.value_norm}"`}
                  body={ev.source_anchor.snippet ?? ev.source_anchor.field_path ?? "—"}
                />
              ))}
              {f.status === "closed" && f.closed_at ? (
                <TimelineRow
                  when={timeAgo(f.closed_at)}
                  title="Investigation closed"
                  body="Sources came back into agreement."
                />
              ) : null}
            </ol>
          </section>
        </div>

        {/* Side rail */}
        <aside>
          <div
            className="rounded-[var(--radius)] border p-5 sticky top-6"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <p className="husn-eyebrow">Actions</p>
            <div className="mt-4 flex flex-col gap-2">
              <ReachOutButton context={reachOutContext(f)} variant="primary">
                Reach Out For Me
              </ReachOutButton>
              <p className="text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                Husn drafts the message and queues it to the person closest to the answer.
              </p>
            </div>
            <ul className="mt-5 space-y-2">
              <ActionItem label="Collect missing information" hint="Ask the relevant sources for a fresh state." />
              <ActionItem label="Ask for an update" hint="Open a thread asking for an answer in 24h." />
              <ActionItem label="Follow up later" hint="Snooze until tomorrow." />
            </ul>

            <hr className="my-5 husn-rule" />

            <p className="husn-eyebrow">Related</p>
            <ul className="mt-4 space-y-2 text-[13px]">
              <li><Link href="/organization" className="hover:underline" style={{ color: "var(--text)" }}>People involved</Link></li>
              <li><Link href="/explore" className="hover:underline" style={{ color: "var(--text)" }}>Connected projects</Link></li>
              <li><Link href="/ask" className="hover:underline" style={{ color: "var(--text)" }}>Ask Husn about this →</Link></li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}

function EvidencePane({ source, items }: { source: string; items: Evidence[] }) {
  const label = SOURCE_LABEL[source] ?? source;
  const head = items[0];
  return (
    <article
      className="rounded-[var(--radius)] border p-5 husn-lift"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <EvidenceChip source={label} cite={`#${head.source_anchor.artifact_id ?? "—"}`} />
      <p className="mt-3 text-[24px] font-semibold" style={{ letterSpacing: "-0.022em" }}>
        {head.value_norm}
      </p>
      {head.source_anchor.snippet ? (
        <blockquote
          className="mt-3 border-l pl-3 text-[13.5px] leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
        >
          “{head.source_anchor.snippet}”
        </blockquote>
      ) : head.source_anchor.field_path ? (
        <p className="mt-3 font-mono text-[12px]" style={{ color: "var(--muted)" }}>
          {head.source_anchor.field_path}
        </p>
      ) : null}
      <p className="mt-4 husn-meta">
        Confidence {Math.round(head.confidence * 100)}% · {head.extractor_id}
      </p>
    </article>
  );
}

function TimelineRow({ when, title, body, first }: { when: string; title: string; body: string; first?: boolean }) {
  return (
    <li className="relative pl-6 pb-6" style={{ marginLeft: -1 }}>
      <span
        aria-hidden
        className="absolute"
        style={{
          left: -5, top: 6, width: 9, height: 9, borderRadius: 999,
          background: first ? "var(--text)" : "var(--panel)",
          border: "1px solid var(--border-strong)",
        }}
      />
      <p className="husn-meta">{when}</p>
      <p className="mt-1 text-[14.5px] font-medium">{title}</p>
      <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>{body}</p>
    </li>
  );
}

function ActionItem({ label, hint }: { label: string; hint: string }) {
  return (
    <li>
      <button
        className="w-full text-left rounded-[10px] border px-3 py-2.5 transition-colors hover:bg-[var(--panel-2)]"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <p className="text-[13.5px] font-medium">{label}</p>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--muted)" }}>{hint}</p>
      </button>
    </li>
  );
}

function SeverityChip({ severity }: { severity: Finding["severity"] }) {
  const map = {
    high: { fill: "var(--danger)", line: "var(--danger-line)", label: "high" },
    medium: { fill: "var(--warning)", line: "var(--warning-line)", label: "elevated" },
    low: { fill: "var(--muted)", line: "var(--border-strong)", label: "low" },
  } as const;
  const s = map[severity];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
      style={{ borderColor: s.line, background: "var(--panel-2)" }}
    >
      <span aria-hidden style={{ background: s.fill, width: 6, height: 6, borderRadius: 999, display: "inline-block" }} />
      <span className="text-[11px] font-medium uppercase" style={{ color: s.fill, letterSpacing: 0.05 }}>
        {s.label}
      </span>
    </span>
  );
}

function StatusChip({ status }: { status: Finding["status"] }) {
  const isOpen = status === "open";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
      style={{
        borderColor: isOpen ? "var(--border-strong)" : "var(--success-line)",
        background: isOpen ? "var(--panel-2)" : "var(--success-soft)",
      }}
    >
      <span aria-hidden style={{ background: isOpen ? "var(--text)" : "var(--success)", width: 6, height: 6, borderRadius: 999, display: "inline-block" }} />
      <span className="text-[11px] font-medium uppercase" style={{ color: isOpen ? "var(--text)" : "var(--success-ink)", letterSpacing: 0.05 }}>
        {status}
      </span>
    </span>
  );
}
