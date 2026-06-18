import Link from "next/link";

import { BriefingCarousel, type CarouselSlide } from "@/components/briefing-carousel";
import { DealtWithButton } from "@/components/dealt-with-button";
import { Pulse as PulseStrip, type PulseDatum } from "@/components/pulse";
import { ReachOutButton, type ReachOutContext } from "@/components/reach-out";
import { serverJson, type Me } from "@/lib/api";

/* ============================================================
   Briefing — the homepage IS the product.
   Six named sections, in order:
     1. Organizational Pulse
     2. Most Consequential Issue
     3. Emerging Risks
     4. Missing Information
     5. Recommended Actions
     6. Active Projects
   Built from the existing findings + graph + agent endpoints.
   ============================================================ */

type PerSourceEvidence = {
  claim_id: number;
  artifact_id: number;
  artifact_kind: string;
  artifact_title: string | null;
  value_norm: string;
  value: string | null;
  confidence: number;
  extractor_id: string;
  source_anchor: { kind: "field" | "span"; field_path?: string; snippet?: string };
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

type GraphSummary = {
  counts: { persons: number; projects: number; artifacts: number; person_identities: number; project_sources: number; artifact_mentions: number; raw_pending_normalization: number };
  last_raw_fetched_at: string | null;
  last_normalized_at: string | null;
};

type ConnectionRow = { id: number; source: string };

type Project = {
  id: number;
  slug: string;
  name: string;
  artifact_count: number;
  scopes: { source: string; kind: string; id: string }[];
};

const SOURCE_LABEL: Record<string, string> = { jira: "Jira", slack: "Slack", google: "Google", microsoft: "Microsoft", email: "Email" };

/* ------- derivations ------- */

const SEV_WEIGHT = { high: 12, medium: 5, low: 1 } as const;
const SEV_RANK = { high: 3, medium: 2, low: 1 } as const;

function confidence(findings: Finding[]): number {
  const w = findings.reduce((acc, f) => acc + SEV_WEIGHT[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - w));
}

function alignment(findings: Finding[]): number {
  const drift = findings.filter((f) => f.rule_id === "R-DATE-1" || f.rule_id === "R-STATUS-1").length;
  return Math.max(0, Math.min(100, 100 - drift * 9));
}

/* "accelerating" | "steady" | "stalling" — based on freshness of normalization. */
function momentum(g?: GraphSummary | null): { label: string; tone: SemanticTone } {
  const ts = g?.last_raw_fetched_at;
  if (!ts) return { label: "settling in", tone: "uncertain" };
  const mins = (Date.now() - Date.parse(ts)) / 60000;
  if (mins < 30) return { label: "accelerating", tone: "aligned" };
  if (mins < 6 * 60) return { label: "steady", tone: "understood" };
  if (mins < 24 * 60) return { label: "easing", tone: "uncertain" };
  return { label: "quiet", tone: "uncertain" };
}

function emergingRisks(findings: Finding[], hours = 48): Finding[] {
  const cut = Date.now() - hours * 3600 * 1000;
  return findings
    .filter((f) => Date.parse(f.opened_at) > cut && f.severity !== "low")
    .sort(byConsequence)
    .slice(0, 4);
}

function missingInformation(findings: Finding[]): Finding[] {
  return findings
    .filter((f) => f.rule_id === "R-OWNER-1" || f.rule_id.startsWith("AGENT-FINDING-"))
    .sort(byConsequence)
    .slice(0, 4);
}

function byConsequence(a: Finding, b: Finding) {
  const s = SEV_RANK[b.severity] - SEV_RANK[a.severity];
  if (s !== 0) return s;
  return Date.parse(b.opened_at) - Date.parse(a.opened_at);
}

function entryKind(rule_id: string): string {
  if (rule_id === "R-DATE-1") return "Date conflict";
  if (rule_id === "R-OWNER-1") return "Ownership gap";
  if (rule_id === "R-STATUS-1") return "Status drift";
  if (rule_id.startsWith("AGENT-FINDING-")) return "Pattern flagged";
  return "Concern";
}

function prettyKey(key?: string | null): string {
  if (!key) return "this";
  const last = key.split("/").pop() || key;
  return last.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function cleanTitle(f: Finding): string {
  const key = prettyKey(f.details?.key);
  if (f.rule_id === "R-DATE-1") return `${key} conflict`;
  if (f.rule_id === "R-STATUS-1") return `${key} drift`;
  if (f.rule_id === "R-OWNER-1") return `${key} unclear`;
  if (f.rule_id.startsWith("AGENT-FINDING-")) return f.summary.split(":")[0].split(" (")[0].trim() || "Pattern flagged";
  return f.summary.split(":")[0].split(" (")[0].trim() || "Concern";
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

function todayHeadline(): string {
  return new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/* Per-finding confidence — lower is worse. */
function perFindingConfidence(f: Finding): number {
  if (f.severity === "high") return 38;
  if (f.severity === "medium") return 62;
  return 84;
}

/* Identify the human(s) likely closest to resolution. We don't have a join to
 * person on findings, so we extract from R-OWNER-1 distinct_values when
 * available, else fall back to the source systems. */
function peopleClosest(f: Finding): string[] {
  if (f.rule_id === "R-OWNER-1") {
    return (f.details?.distinct_values ?? []).filter(Boolean).slice(0, 4);
  }
  const sources = Object.keys(f.details?.per_source ?? {});
  return sources.map((s) => `Owner in ${SOURCE_LABEL[s] ?? s}`).slice(0, 2);
}

/* Build a Reach-Out context from a finding. Editorial — the goal is a draft
 * that's already 90% ready to send. */
function reachOutContext(f: Finding): ReachOutContext {
  const people = peopleClosest(f);
  const who = people[0] ?? "The owner";
  const title = cleanTitle(f).toLowerCase();
  const sources = Object.keys(f.details?.per_source ?? {});
  const sourceList = sources.map((s) => SOURCE_LABEL[s] ?? s).join(" and ");

  if (f.rule_id === "R-DATE-1") {
    const distinct = f.details?.distinct_values ?? [];
    return {
      who,
      why: `${SOURCE_LABEL[sources[0]] ?? "One source"} and ${SOURCE_LABEL[sources[1]] ?? "another"} are recording different dates. They were closest to the last change.`,
      about: cleanTitle(f),
      draft: `Hey — quick one. ${sourceList} are showing different dates for ${prettyKey(f.details?.key).toLowerCase()}${distinct.length >= 2 ? ` (${distinct[0]} vs ${distinct[1]})` : ""}. Which one should we treat as the source of truth so I can keep downstream plans aligned?`,
      via: sources.includes("slack") ? "slack" : "email",
    };
  }
  if (f.rule_id === "R-STATUS-1") {
    const distinct = f.details?.distinct_values ?? [];
    return {
      who,
      why: `Status is being reported differently across ${sourceList || "tools"}. They have ground truth.`,
      about: cleanTitle(f),
      draft: `Hey — saw ${SOURCE_LABEL[sources[0]] ?? "one source"} marked "${distinct[0] ?? "one status"}" and ${SOURCE_LABEL[sources[1]] ?? "another"} "${distinct[1] ?? "another"}". Where are we actually? Want to make sure the rest of the team is reading the same picture.`,
      via: sources.includes("slack") ? "slack" : "email",
    };
  }
  if (f.rule_id === "R-OWNER-1") {
    return {
      who: people.join(", ") || "Possible owners",
      why: `Multiple names are showing up as the owner across ${sourceList || "tools"}. Worth a confirm.`,
      about: cleanTitle(f),
      draft: `Hi — small confirm: who's the single owner on ${prettyKey(f.details?.key).toLowerCase()} right now? I'm seeing a few names and want to point updates at the right person.`,
      via: "slack",
    };
  }
  return {
    who,
    why: "Husn surfaced uncertainty here and they have the most recent context.",
    about: cleanTitle(f),
    draft: `Hi — could you give me a quick read on where we are with this? Trying to align before the next planning cycle.`,
    via: "slack",
  };
}

/* =====================================================
   Page
   ===================================================== */

export default async function Briefing() {
  const [findingsRes, statusRes, graphSummary, projectsRes, connectionsRes, me] = await Promise.all([
    serverJson<{ items: Finding[] }>("/api/findings?status=open&limit=40"),
    serverJson<AgentStatus>("/api/agent/status"),
    serverJson<GraphSummary>("/api/graph/summary"),
    serverJson<{ projects: Project[] }>("/api/graph/projects"),
    serverJson<{ items: ConnectionRow[] }>("/api/connections"),
    serverJson<Me>("/auth/me"),
  ]);

  const role = me?.workspace?.role;
  const isAdmin = role === "owner" || role === "admin";

  const findings = (findingsRes?.items ?? []).sort(byConsequence);
  const projects = projectsRes?.projects ?? [];
  const top = findings[0] ?? null;
  const connectionsCount = connectionsRes?.items?.length ?? 0;
  const artifactCount = graphSummary?.counts?.artifacts ?? 0;
  const lastRun = statusRes?.last_run_at ?? null;

  // "Awaiting first sync" — no connections AND no artifacts. The agent cron
  // creates an agent_runs row every 30 min even with an empty skeleton, so
  // last_run_at is unreliable as an "has data" signal. Connections + artifacts
  // are the truth.
  const awaiting = connectionsCount === 0 && artifactCount === 0;

  if (awaiting) {
    return <BriefingAwaiting isAdmin={isAdmin} />;
  }

  const conf = confidence(findings);
  const alig = alignment(findings);
  const mom = momentum(graphSummary);
  const risks = emergingRisks(findings);
  const missing = missingInformation(findings);

  // The briefing is presented as a deck: each section fills the stage and you
  // advance through them. Sections are rendered server-side and handed to the
  // client carousel as slide nodes (data + derivations stay here).
  const heroTone = top?.severity === "high" ? "var(--conflict)" : top ? "var(--uncertain)" : "var(--aligned)";
  const slides: CarouselSlide[] = [
    {
      id: "briefing",
      kicker: "01",
      title: "Today's briefing",
      watermark: "Briefing",
      tone: "var(--accent)",
      summary: "The day's picture — confidence, alignment, momentum and risk.",
      node: (
        <div>
          <p className="husn-prose max-w-[68ch]" style={{ fontSize: 16.5 }}>
            {leadIn(findings.length, conf)}
          </p>
          <p className="husn-eyebrow mt-8 mb-3">Organizational Pulse</p>
          <PulseStrip data={pulseData(findings, conf, alig, mom, risks)} />
        </div>
      ),
    },
    {
      id: "consequential",
      kicker: "02",
      title: "Most Consequential",
      watermark: "Issue",
      tone: heroTone,
      summary: "The single issue costing you the most right now.",
      node: top ? <ConsequentialIssue f={top} /> : <AllClear />,
    },
    {
      id: "risks",
      kicker: "03",
      title: "Emerging Risks",
      watermark: "Risks",
      tone: risks.length ? "var(--conflict)" : "var(--aligned)",
      summary: "What surfaced in the last 48 hours.",
      node: <RiskList items={risks} />,
    },
    {
      id: "missing",
      kicker: "04",
      title: "Missing Information",
      watermark: "Gaps",
      tone: "var(--predicted)",
      summary: "Owners and context Husn still needs to brief you well.",
      node: <MissingList items={missing} />,
    },
    {
      id: "actions",
      kicker: "05",
      title: "Recommended Actions",
      watermark: "Actions",
      tone: "var(--accent)",
      summary: "The next moves, drafted and ready to send.",
      node: <RecommendedActions findings={findings} />,
    },
    {
      id: "projects",
      kicker: "06",
      title: "Active Projects",
      watermark: "Work",
      tone: "var(--aligned)",
      summary: "Active workstreams and where each one stands.",
      node: <ActiveProjects projects={projects} findings={findings} />,
    },
  ];

  return (
    <BriefingCarousel
      slides={slides}
      title="Today's briefing"
      dateLabel={todayHeadline()}
      refreshedLabel={timeAgo(lastRun)}
    />
  );
}

/* =====================================================
   "Awaiting first sync" — fresh workspace, no data yet.
   Pulse is intentionally neutral / muted; no 100% rings,
   no "all in sync" framing. Just one prominent CTA.
   ===================================================== */

function BriefingAwaiting({ isAdmin = false }: { isAdmin?: boolean }) {
  return (
    <main className="mx-auto px-6 lg:px-12 pt-12 pb-32" style={{ maxWidth: 1100 }}>
      <header className="husn-rise" style={{ maxWidth: 720 }}>
        <p className="husn-meta">{todayHeadline()} · No briefing yet</p>
        <h1 className="husn-display mt-4">Today&apos;s briefing.</h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          Connect a tool and Husn will start reading. Your first briefing
          builds within about an hour of the first sync.
        </p>
      </header>

      <section className="mt-14 husn-rise" style={{ animationDelay: "40ms" }}>
        <SectionLabel kicker="01" title="Organizational Pulse" />
        <AwaitingPulse />
      </section>

      <section className="mt-20 husn-rise" style={{ animationDelay: "100ms" }}>
        <article
          className="rounded-[var(--radius-xl)] border p-10 lg:p-14"
          style={{ borderColor: "var(--border)", background: "var(--panel)", boxShadow: "var(--shadow-md)" }}
        >
          <p className="husn-eyebrow">Get started</p>
          <h2 className="husn-title mt-4" style={{ fontSize: 36, lineHeight: 1.12, maxWidth: "20ch" }}>
            Connect your tools.
          </h2>
          <p className="husn-prose mt-5 max-w-[62ch]">
            As you connect Slack, Jira, Google, and Microsoft, Husn maps the
            work your team is already doing, surfaces conflicts and ownership
            gaps, and writes a per-persona briefing every morning. Every claim
            stays sourced.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link
              href="/connections"
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[14px] font-semibold"
              style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
            >
              Connect tools →
            </Link>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13.5px] font-medium"
              style={{ background: "var(--panel)", color: "var(--text)", borderColor: "var(--border-strong)" }}
            >
              Invite teammates
            </Link>
          </div>
        </article>
      </section>

      <footer className="mt-24 pt-6 border-t" style={{ borderColor: "var(--rule)" }}>
        <p className="husn-meta">
          Once data is flowing, the briefing populates here.{" "}
          <Link href="/ask" style={{ color: "var(--accent)" }} className="font-medium">
            Ask Husn anything
          </Link>{" "}
          works the moment you have a connection.
        </p>
      </footer>
    </main>
  );
}

function AwaitingPulse() {
  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-[var(--radius-lg)] border"
      style={{ background: "var(--rule)", borderColor: "var(--border)" }}
    >
      {[
        { label: "Confidence", caption: "Builds as Husn reads your sources." },
        { label: "Alignment", caption: "Surfaces once two sources can be compared." },
        { label: "Momentum", caption: "Tracks activity across connected tools." },
        { label: "Emerging Risks", caption: "Nothing to flag until data is flowing." },
      ].map((cell) => (
        <div key={cell.label} className="p-6" style={{ background: "var(--panel)" }}>
          <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>{cell.label}</p>
          <div className="mt-4 flex items-center gap-5">
            <span
              aria-hidden
              className="inline-block rounded-full shrink-0"
              style={{
                width: 14,
                height: 14,
                background: "var(--panel-2)",
                border: "1px solid var(--border-strong)",
              }}
            />
            <div>
              <p
                className="tabular"
                style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.018em", lineHeight: 1, color: "var(--muted-2)" }}
              >
                —
              </p>
              <p className="mt-2 text-[12.5px] leading-snug" style={{ color: "var(--muted)", maxWidth: "22ch" }}>
                {cell.caption}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function leadIn(count: number, conf: number): string {
  if (count === 0) {
    return "Across your tools, nothing is drifting. Husn is still reading — you'll see something here the moment that changes.";
  }
  const c = conf >= 75 ? "calm" : conf >= 50 ? "watchful" : "demanding";
  return `The picture is ${c}. ${count === 1 ? "One concern is open" : `${count} concerns are open`}, ranked below by what costs the most if ignored — not what came in last.`;
}

/* =====================================================
   Section primitives
   ===================================================== */

function SectionLabel({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-5">
      <span className="tabular text-[11px] font-medium" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>
        {kicker}
      </span>
      <h2 className="husn-heading" style={{ fontSize: 22 }}>{title}</h2>
    </div>
  );
}

type SemanticTone = "aligned" | "uncertain" | "conflict" | "predicted" | "understood";

function toneColor(t: SemanticTone): { fill: string; soft: string; line: string; ink: string } {
  switch (t) {
    case "aligned": return { fill: "var(--aligned)", soft: "var(--aligned-soft)", line: "var(--aligned-line)", ink: "var(--success-ink)" };
    case "uncertain": return { fill: "var(--uncertain)", soft: "var(--uncertain-soft)", line: "var(--uncertain-line)", ink: "var(--warning-ink)" };
    case "conflict": return { fill: "var(--conflict)", soft: "var(--conflict-soft)", line: "var(--conflict-line)", ink: "var(--danger-ink)" };
    case "predicted": return { fill: "var(--predicted)", soft: "var(--predicted-soft)", line: "var(--predicted-line)", ink: "var(--predicted-ink)" };
    case "understood": return { fill: "var(--understood)", soft: "var(--understood-soft)", line: "var(--understood-line)", ink: "var(--accent-ink)" };
  }
}

function metricTone(v: number): SemanticTone {
  if (v >= 75) return "aligned";
  if (v >= 50) return "understood";
  if (v >= 30) return "uncertain";
  return "conflict";
}

/* =====================================================
   1. Pulse — driven by the client `<PulseStrip>` for
   animation + interactivity. This helper builds its
   data props from the existing findings.
   ===================================================== */

function dailyBuckets(findings: Finding[], days = 7): number[] {
  const buckets = new Array(days).fill(0);
  const dayMs = 86400 * 1000;
  const start = Date.now() - (days - 1) * dayMs;
  for (const f of findings) {
    const t = Date.parse(f.opened_at);
    if (!Number.isFinite(t)) continue;
    const idx = Math.floor((t - start) / dayMs);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

function inverseSeries(counts: number[]): number[] {
  const max = Math.max(...counts, 1);
  return counts.map((c) => 1 - c / max);
}

function pulseData(
  findings: Finding[],
  conf: number,
  alig: number,
  mom: { label: string; tone: SemanticTone },
  risks: Finding[],
): PulseDatum[] {
  const allBuckets = dailyBuckets(findings);
  const driftBuckets = dailyBuckets(findings.filter((f) => f.rule_id === "R-DATE-1" || f.rule_id === "R-STATUS-1"));
  const riskBuckets = dailyBuckets(risks);

  // Severity composition for the breakdown drawer
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  const low = findings.filter((f) => f.severity === "low").length;

  return [
    {
      key: "confidence",
      label: "Confidence",
      kind: "ring",
      value: conf,
      tone: metricTone(conf),
      caption: confidenceCaption(conf),
      series: inverseSeries(allBuckets),
      href: "/explore?lens=risks",
      breakdown: [
        { label: "High-severity concerns", value: `${high}` },
        { label: "Medium-severity", value: `${medium}` },
        { label: "Low-severity / informational", value: `${low}` },
        { label: "Trend (last 7 days)", value: trendLabel(allBuckets) },
      ],
    },
    {
      key: "alignment",
      label: "Alignment",
      kind: "ring",
      value: alig,
      tone: metricTone(alig),
      caption: alignmentCaption(alig),
      series: inverseSeries(driftBuckets),
      href: "/explore?lens=risks",
      breakdown: [
        { label: "Date conflicts open", value: `${findings.filter((f) => f.rule_id === "R-DATE-1").length}` },
        { label: "Status drift open", value: `${findings.filter((f) => f.rule_id === "R-STATUS-1").length}` },
        { label: "Ownership unclear", value: `${findings.filter((f) => f.rule_id === "R-OWNER-1").length}` },
        { label: "Trend (last 7 days)", value: trendLabel(driftBuckets) },
      ],
    },
    {
      key: "momentum",
      label: "Momentum",
      kind: "text",
      value: mom.label,
      tone: mom.tone,
      caption: momentumCaption(mom.label),
      href: "/organization",
      breakdown: [
        { label: "Reading cadence", value: mom.label },
        { label: "Last refresh", value: mom.label === "quiet" ? "more than a day ago" : "within the hour" },
      ],
    },
    {
      key: "risks",
      label: "Emerging Risks",
      kind: "text",
      value: risks.length === 0 ? "None" : `${risks.length} active`,
      tone: risks.length === 0 ? "aligned" : risks.length <= 2 ? "uncertain" : "conflict",
      caption: risks.length === 0 ? "Nothing new in the last 48 hours." : "Surfaced in the last 48 hours.",
      series: inverseSeries(riskBuckets).map((v) => 1 - v),
      href: "/explore?lens=risks",
      breakdown: risks.slice(0, 4).map((f) => ({
        label: entryKind(f.rule_id),
        value: cleanTitle(f),
      })),
    },
  ];
}

function trendLabel(buckets: number[]): string {
  if (buckets.length < 2) return "—";
  const a = buckets.slice(0, Math.floor(buckets.length / 2)).reduce((x, y) => x + y, 0);
  const b = buckets.slice(Math.floor(buckets.length / 2)).reduce((x, y) => x + y, 0);
  if (b > a + 1) return "rising";
  if (a > b + 1) return "easing";
  return "steady";
}

function confidenceCaption(v: number): string {
  if (v >= 85) return "The picture is well-supported by every connected source.";
  if (v >= 60) return "A few open questions, none yet urgent.";
  if (v >= 35) return "Several open questions are dragging on the picture.";
  return "Multiple sources disagree. Confidence is constrained until they're reconciled.";
}
function alignmentCaption(v: number): string {
  if (v >= 85) return "Sources agree on the facts that matter.";
  if (v >= 60) return "Minor disagreements between tools.";
  if (v >= 35) return "Recurring mismatches across tools.";
  return "Multiple active conflicts between systems.";
}
function momentumCaption(label: string): string {
  if (label === "accelerating") return "Fresh updates across the org in the last 30 minutes.";
  if (label === "steady") return "Activity within normal cadence.";
  if (label === "easing") return "Quieter than usual today.";
  if (label === "quiet") return "Little activity. Worth checking whether work is happening elsewhere.";
  return "Husn is still building a baseline.";
}


/* =====================================================
   2. Most Consequential Issue — the dominating hero block.
   ===================================================== */

function ConsequentialIssue({ f }: { f: Finding }) {
  const c = perFindingConfidence(f);
  const sources = Object.keys(f.details?.per_source ?? {});
  const people = peopleClosest(f);
  const impact = impactNarration(f);
  const ctx = reachOutContext(f);
  const tone: SemanticTone = f.severity === "high" ? "conflict" : "uncertain";
  const cc = toneColor(tone);

  return (
    <article
      className="relative overflow-hidden rounded-[var(--radius-xl)] border"
      style={{
        background: "var(--panel)",
        borderColor: cc.line,
        boxShadow: "var(--shadow-md)",
      }}
    >
      {/* tinted gutter on the left as a quiet semantic cue */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-[5px]" style={{ background: cc.fill }} />

      <div className="p-10 lg:p-14">
        <div className="flex flex-wrap items-center gap-3">
          <SeverityChip tone={tone} label={entryKind(f.rule_id)} />
          <span className="husn-meta">Open · {timeAgo(f.opened_at)}</span>
        </div>

        <h3 className="mt-5" style={{ fontSize: 40, lineHeight: 1.08, letterSpacing: "-0.026em", fontWeight: 600, maxWidth: "20ch" }}>
          {consequentialTitle(f)}
        </h3>

        {/* Confidence bar + numeric */}
        <div className="mt-6 flex items-center gap-4 max-w-[520px]">
          <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>Confidence</p>
          <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: "var(--panel-2)" }}>
            <div
              className="h-full"
              style={{
                width: `${c}%`,
                background: cc.fill,
                transition: "width 700ms ease",
              }}
            />
          </div>
          <p className="tabular" style={{ fontSize: 15, fontWeight: 600, color: cc.fill }}>{c}%</p>
        </div>

        {/* Narrative */}
        <p className="husn-prose mt-7 max-w-[64ch]" style={{ fontSize: 17 }}>
          {consequentialNarration(f)}
        </p>

        {/* Impact + People — editorial two-column */}
        <div className="mt-9 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <p className="husn-eyebrow">Potential impact</p>
            <ul className="mt-3 space-y-1.5 text-[14.5px]" style={{ color: "var(--text-2)" }}>
              {impact.map((line, i) => (
                <li key={i} className="flex gap-2"><span aria-hidden style={{ color: "var(--muted-2)" }}>—</span><span>{line}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="husn-eyebrow">People closest to resolution</p>
            <ul className="mt-3 space-y-1.5">
              {people.length === 0 ? (
                <li className="text-[14px]" style={{ color: "var(--muted)" }}>Owner unconfirmed — Husn would start by asking the sources below.</li>
              ) : people.map((p, i) => (
                <li key={i} className="text-[14.5px]" style={{ color: "var(--text-2)" }}>
                  <span style={{ color: "var(--text)", fontWeight: 500 }}>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Sources */}
        {sources.length > 0 ? (
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>Sources</p>
            {sources.flatMap((src) =>
              (f.details?.per_source[src] ?? []).slice(0, 1).map((ev) => (
                <SourceChip key={`${src}-${ev.claim_id}`} source={src} cite={ev.artifact_title ?? `#${ev.artifact_id}`} />
              )),
            )}
          </div>
        ) : null}

        {/* Actions */}
        <div className="mt-10 flex flex-wrap items-center gap-2.5">
          <PrimaryAction href={`/investigations/${f.id}`}>Investigate</PrimaryAction>
          <SecondaryAction href={`/ask?q=${encodeURIComponent("Why is " + cleanTitle(f).toLowerCase() + " happening?")}`}>Ask Husn</SecondaryAction>
          <ReachOutButton context={ctx} variant="primary">Reach Out For Me</ReachOutButton>
          <GhostAction href={`/investigations/${f.id}?action=collect`}>Collect missing information</GhostAction>
          <DealtWithButton findingId={f.id} />
        </div>
      </div>
    </article>
  );
}

function consequentialTitle(f: Finding): string {
  // For the hero we want something with weight — frame the consequence, not the symptom.
  const k = prettyKey(f.details?.key).toLowerCase();
  if (f.rule_id === "R-DATE-1") return `${prettyKey(f.details?.key)} is no longer agreed across tools.`;
  if (f.rule_id === "R-STATUS-1") return `${prettyKey(f.details?.key)} is being reported differently.`;
  if (f.rule_id === "R-OWNER-1") return `Ownership of ${k} is unclear.`;
  if (f.rule_id.startsWith("AGENT-FINDING-")) return `${cleanTitle(f)} — Husn flagged a pattern.`;
  return cleanTitle(f);
}

function consequentialNarration(f: Finding): string {
  const sources = Object.keys(f.details?.per_source ?? {});
  const distinct = f.details?.distinct_values ?? [];
  const opened = timeAgo(f.opened_at);
  if (f.rule_id === "R-DATE-1" && sources.length >= 2 && distinct.length >= 2) {
    return `${SOURCE_LABEL[sources[0]] ?? sources[0]} commits to ${distinct[0]}. ${SOURCE_LABEL[sources[1]] ?? sources[1]} cites ${distinct[1]}. No one has reconciled the difference since this opened ${opened}; decisions downstream are riding on whichever date the reader happened to see.`;
  }
  if (f.rule_id === "R-STATUS-1" && sources.length >= 2 && distinct.length >= 2) {
    return `${SOURCE_LABEL[sources[0]] ?? sources[0]} reports "${distinct[0]}". ${SOURCE_LABEL[sources[1]] ?? sources[1]} reports "${distinct[1]}". The two pictures haven't aligned in ${opened}.`;
  }
  if (f.rule_id === "R-OWNER-1") {
    return `${distinct.length || "Several"} possible owners are showing up across ${sources.map((s) => SOURCE_LABEL[s] ?? s).join(" and ") || "the connected tools"}. Without a confirmed single owner, asks land in different inboxes and nothing closes.`;
  }
  return `Surfaced ${opened}. The evidence is below — verify, then resolve.`;
}

function impactNarration(f: Finding): string[] {
  const k = prettyKey(f.details?.key).toLowerCase();
  if (f.rule_id === "R-DATE-1") return [
    "Downstream campaigns may be planning against the wrong target.",
    "Customer commitments could outrun engineering capacity.",
    "Stakeholders may be quoting different numbers in the same meeting.",
  ];
  if (f.rule_id === "R-STATUS-1") return [
    "Reports up the chain depend on which tool the reader opens.",
    "Dependencies may be assuming completion that hasn't happened.",
  ];
  if (f.rule_id === "R-OWNER-1") return [
    "Asks land in different inboxes and nothing closes.",
    "Accountability is diffused; decisions stall.",
  ];
  return [`Confidence in ${k || "this area"} is constrained until resolved.`];
}

/* =====================================================
   3. Emerging Risks list
   ===================================================== */

function RiskList({ items }: { items: Finding[] }) {
  if (items.length === 0) {
    return (
      <EditorialEmpty
        title="No new risks in the last 48 hours."
        body="Husn keeps watching. You'll see new risks here the moment they surface."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((f) => {
        const tone: SemanticTone = f.severity === "high" ? "conflict" : "uncertain";
        return (
          <li
            key={f.id}
            className="rounded-[var(--radius)] border husn-lift"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <Link href={`/investigations/${f.id}`} className="block px-5 pt-4 pb-2">
              <div className="flex items-start gap-3">
                <SeverityDot tone={tone} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className="text-[14.5px] font-medium">{consequentialTitle(f)}</p>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                    {entryKind(f.rule_id)} · {timeAgo(f.opened_at)}
                  </p>
                </div>
                <span aria-hidden className="shrink-0 self-center text-[14px]" style={{ color: "var(--muted)" }}>→</span>
              </div>
            </Link>
            <div className="flex justify-end px-5 pb-3">
              <DealtWithButton findingId={f.id} size="sm" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* =====================================================
   4. Missing Information list — with inline ReachOut
   ===================================================== */

function MissingList({ items }: { items: Finding[] }) {
  if (items.length === 0) {
    return (
      <EditorialEmpty
        title="No information gaps."
        body="Owners are confirmed and Husn isn't missing context that would help it brief you."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((f) => {
        const ctx = reachOutContext(f);
        return (
          <li
            key={f.id}
            className="rounded-[var(--radius)] border px-5 py-4"
            style={{ borderColor: "var(--predicted-line)", background: "var(--predicted-soft)" }}
          >
            <div className="flex items-start gap-3">
              <span aria-hidden className="mt-1 shrink-0 inline-block rounded-full husn-pulse" style={{ width: 8, height: 8, background: "var(--predicted)" }} />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-medium" style={{ color: "var(--text)" }}>
                  {missingFraming(f)}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>
                  {ctx.why}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ReachOutButton context={ctx} variant="secondary" size="sm">Reach Out For Me</ReachOutButton>
                  <Link
                    href={`/investigations/${f.id}`}
                    className="rounded-full border px-2.5 py-1 text-[12.5px] font-medium"
                    style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
                  >
                    See evidence
                  </Link>
                  <DealtWithButton findingId={f.id} size="sm" />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function missingFraming(f: Finding): string {
  const k = prettyKey(f.details?.key).toLowerCase();
  if (f.rule_id === "R-OWNER-1") return `We need a confirmed owner on ${k}.`;
  if (f.rule_id.startsWith("AGENT-FINDING-")) return cleanTitle(f);
  return `Husn is missing a clean read on ${k}.`;
}

/* =====================================================
   5. Recommended Actions — synthesized to-dos
   ===================================================== */

function RecommendedActions({ findings }: { findings: Finding[] }) {
  const items = findings.slice(0, 5).map((f) => ({ f, ...synthesizeAction(f) }));
  if (items.length === 0) {
    return (
      <EditorialEmpty
        title="Nothing to act on."
        body="When new risks land, Husn will draft the right next move here."
      />
    );
  }
  return (
    <ol className="space-y-2">
      {items.map(({ f, verb, target, hint }, i) => {
        const ctx = reachOutContext(f);
        return (
          <li
            key={f.id}
            className="rounded-[var(--radius)] border px-5 py-4 husn-lift"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <div className="flex items-start gap-4">
              <span
                className="shrink-0 tabular text-[12.5px] font-semibold rounded-full grid place-items-center"
                style={{ width: 26, height: 26, background: "var(--panel-2)", color: "var(--muted)" }}
                aria-hidden
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px]" style={{ color: "var(--text)" }}>
                  <span style={{ fontWeight: 600 }}>{verb}</span> {target}
                </p>
                <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>{hint}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ReachOutButton context={ctx} variant="secondary" size="sm" />
                  <Link
                    href={`/investigations/${f.id}`}
                    className="rounded-full border px-3 py-1 text-[12.5px] font-medium"
                    style={{ borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--text-2)" }}
                  >
                    Investigate
                  </Link>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function synthesizeAction(f: Finding): { verb: string; target: string; hint: string } {
  const k = prettyKey(f.details?.key).toLowerCase();
  const sources = Object.keys(f.details?.per_source ?? {});
  const peers = sources.map((s) => SOURCE_LABEL[s] ?? s).join(" and ") || "the team";
  if (f.rule_id === "R-DATE-1") return {
    verb: "Reconcile",
    target: `${k} between ${peers}.`,
    hint: "Pick one source of truth so downstream plans can settle.",
  };
  if (f.rule_id === "R-STATUS-1") return {
    verb: "Align",
    target: `status on ${k}.`,
    hint: "Two systems are telling stakeholders different things.",
  };
  if (f.rule_id === "R-OWNER-1") return {
    verb: "Confirm",
    target: `the owner of ${k}.`,
    hint: "Until one name is set, asks land in multiple inboxes.",
  };
  return {
    verb: "Investigate",
    target: cleanTitle(f).toLowerCase() + ".",
    hint: "Husn flagged a pattern worth a quick look.",
  };
}

/* =====================================================
   6. Active Projects — strategic, not tabular.
   ===================================================== */

function ActiveProjects({ projects, findings }: { projects: Project[]; findings: Finding[] }) {
  if (projects.length === 0) {
    return (
      <EditorialEmpty
        title="No projects mapped yet."
        body={
          <>
            Connect a tool so Husn has somewhere to read from.{" "}
            <Link href="/connections" style={{ color: "var(--accent)" }} className="font-medium">Open Connections →</Link>
          </>
        }
      />
    );
  }
  return (
    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {projects.slice(0, 6).map((p) => {
        // findings don't currently carry project_id — but their evidence often references
        // it. As a proxy, attribute open findings using artifact_title containing the slug.
        const related = findings.filter((f) =>
          Object.values(f.details?.per_source ?? {}).some((arr) =>
            arr.some((ev) => (ev.artifact_title ?? "").toLowerCase().includes(p.slug.toLowerCase())),
          ),
        ).length;
        const tone: SemanticTone =
          related === 0 ? "aligned" :
          related <= 2 ? "uncertain" :
          "conflict";
        const cc = toneColor(tone);
        return (
          <li key={p.id}>
            <Link
              href={`/organization`}
              className="block rounded-[var(--radius)] border px-5 py-5 husn-lift"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10.5px] font-mono uppercase" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>
                    {p.slug}
                  </p>
                  <h3 className="husn-heading mt-1.5" style={{ fontSize: 18 }}>{p.name}</h3>
                  <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
                    {projectStateNarration(related)}
                  </p>
                </div>
                <span aria-hidden className="shrink-0 mt-1 inline-block rounded-full husn-pulse" style={{ width: 10, height: 10, background: cc.fill, boxShadow: `0 0 0 5px ${cc.soft}` }} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {p.scopes.slice(0, 4).map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]"
                    style={{ borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--muted)" }}
                  >
                    {SOURCE_LABEL[s.source] ?? s.source}
                  </span>
                ))}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function projectStateNarration(openIssues: number): string {
  if (openIssues === 0) return "Quiet. Husn is watching this workstream.";
  if (openIssues === 1) return "One open concern.";
  return `${openIssues} open concerns — see the Briefing above.`;
}

/* =====================================================
   Shared bits
   ===================================================== */

function SeverityChip({ tone, label }: { tone: SemanticTone; label: string }) {
  const c = toneColor(tone);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
      style={{ borderColor: c.line, background: c.soft }}
    >
      <span aria-hidden className="husn-pulse" style={{ background: c.fill, width: 6, height: 6, borderRadius: 999, display: "inline-block" }} />
      <span className="text-[11px] font-medium uppercase" style={{ color: c.ink, letterSpacing: 0.05 }}>
        {label}
      </span>
    </span>
  );
}

function SeverityDot({ tone }: { tone: SemanticTone }) {
  const c = toneColor(tone);
  return (
    <span
      aria-hidden
      className="mt-1 inline-block rounded-full shrink-0 husn-pulse"
      style={{ width: 10, height: 10, background: c.fill, boxShadow: `0 0 0 5px ${c.soft}` }}
    />
  );
}

function SourceChip({ source, cite }: { source: string; cite: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]"
      style={{ borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--muted)" }}
      title={`${SOURCE_LABEL[source] ?? source} · ${cite}`}
    >
      <span style={{ opacity: 0.85 }}>{SOURCE_LABEL[source] ?? source}</span>
      <span aria-hidden style={{ opacity: 0.4 }}>·</span>
      <span className="font-medium" style={{ color: "var(--text-2)" }}>{cite}</span>
    </span>
  );
}

function PrimaryAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13.5px] font-medium"
      style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
    >
      {children}
    </Link>
  );
}
function SecondaryAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13.5px] font-medium"
      style={{ background: "var(--panel)", color: "var(--text)", borderColor: "var(--border-strong)" }}
    >
      {children}
    </Link>
  );
}
function GhostAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium"
      style={{ background: "transparent", color: "var(--muted)" }}
    >
      {children}
    </Link>
  );
}

function EditorialEmpty({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius)] border border-dashed px-6 py-10"
      style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}
    >
      <p className="text-[14.5px] font-medium" style={{ color: "var(--text)" }}>{title}</p>
      <div className="mt-2 text-[13px] leading-relaxed max-w-[58ch]" style={{ color: "var(--muted)" }}>{body}</div>
    </div>
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
      <SeverityChip tone="aligned" label="All clear" />
      <h3 className="mt-5" style={{ fontSize: 36, lineHeight: 1.12, letterSpacing: "-0.024em", fontWeight: 600, maxWidth: "22ch" }}>
        No active conflicts. The org is in sync.
      </h3>
      <p className="husn-prose mt-5 max-w-[60ch]">
        Husn is reading continuously. The moment two sources disagree, an owner goes silent,
        or a status quietly shifts — it lands here, with the evidence to act on it.
      </p>
      <div className="mt-8 flex flex-wrap gap-2.5">
        <PrimaryAction href="/ask">Ask Husn a question</PrimaryAction>
        <SecondaryAction href="/organization">See the organization</SecondaryAction>
      </div>
    </article>
  );
}
