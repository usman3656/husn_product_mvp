import Link from "next/link";

import { CriticalPeople, type CriticalPerson } from "@/components/critical-people";
import { ReachOutButton, type ReachOutContext } from "@/components/reach-out";
import { WeeklySignal, type SignalDay } from "@/components/weekly-signal";
import { FETCH_INIT } from "@/lib/fetch-init";

/* ============================================================
   Organization — strategic, actionable, interactive.
   Sections, in order:
     1. State of the org (hero, compact pulse)
     2. Where to focus today (top bottlenecks)
     3. Workstreams (all, strategic cards)
     4. Critical Path People (interactive)
     5. This week's signal (interactive chart)
     6. Connector health
   ============================================================ */

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

type Project = {
  id: number; slug: string; name: string; artifact_count: number;
  scopes: { source: string; kind: string; id: string }[];
};
type Person = {
  id: number; primary_name: string | null; primary_email: string | null;
  identities: { source: string; display_name: string | null; email: string | null }[];
};
type Finding = {
  id: number; rule_id: string; severity: "low" | "medium" | "high";
  summary: string;
  details: { key: string; distinct_values: string[]; per_source: Record<string, { artifact_title?: string | null }[]> } | null;
  opened_at: string; closed_at: string | null;
  status: "open" | "closed" | "snoozed";
};
type ConnectionRow = {
  id: number; source: string; account_label: string | null;
  token_status: "ok" | "expiring-soon" | "expired" | "expired-no-refresh";
  last_raw_fetched_at: string | null;
  artifact_count: number;
};

async function safeFetch<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url, FETCH_INIT); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

const SOURCE_LABEL: Record<string, string> = { jira: "Jira", slack: "Slack", google: "Google", microsoft: "Microsoft" };

export default async function OrganizationPage() {
  const [projectsRes, personsRes, openFindingsRes, allFindingsRes, connectionsRes] = await Promise.all([
    safeFetch<{ projects: Project[] }>(`${SERVER_API_URL}/api/graph/projects`),
    safeFetch<{ persons: Person[] }>(`${SERVER_API_URL}/api/graph/persons?limit=200`),
    safeFetch<{ items: Finding[] }>(`${SERVER_API_URL}/api/findings?status=open&limit=200`),
    safeFetch<{ items: Finding[] }>(`${SERVER_API_URL}/api/findings?status=all&limit=400`),
    safeFetch<{ items: ConnectionRow[] }>(`${SERVER_API_URL}/api/connections`),
  ]);

  const projects = projectsRes?.projects ?? [];
  const persons = personsRes?.persons ?? [];
  const open = openFindingsRes?.items ?? [];
  const all = allFindingsRes?.items ?? [];
  const connections = connectionsRes?.items ?? [];

  // Per-project strain heuristic: open findings whose evidence titles contain the slug
  const strainByProject = new Map<number, Finding[]>();
  for (const p of projects) {
    const slug = p.slug.toLowerCase();
    strainByProject.set(p.id, open.filter((f) =>
      Object.values(f.details?.per_source ?? {}).some((arr) =>
        arr.some((ev) => (ev.artifact_title ?? "").toLowerCase().includes(slug)),
      ),
    ));
  }

  const bottlenecks = [...projects]
    .sort((a, b) => (strainByProject.get(b.id)?.length ?? 0) - (strainByProject.get(a.id)?.length ?? 0))
    .filter((p) => (strainByProject.get(p.id)?.length ?? 0) > 0)
    .slice(0, 3);

  // Org-level confidence + alignment (compact pulse)
  const conf = orgConfidence(open);
  const alig = orgAlignment(open);

  return (
    <main className="mx-auto px-6 lg:px-12 pt-12 pb-32" style={{ maxWidth: 1100 }}>
      {/* 1. State of the org */}
      <header className="husn-rise" style={{ maxWidth: 760 }}>
        <p className="husn-eyebrow">Organization</p>
        <h1 className="husn-display mt-4">{stateOfTheOrg(open, projects.length)}</h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          {howWeRead(projects.length, persons.length, open.length)}
        </p>
      </header>

      <section className="mt-12 husn-rise" style={{ animationDelay: "40ms" }}>
        <CompactPulse confidence={conf} alignment={alig} bottlenecks={bottlenecks.length} stale={staleCount(open)} />
      </section>

      {/* 2. Where to focus today */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "100ms" }}>
        <Section kicker="01" title="Where to focus today" />
        {bottlenecks.length === 0 ? (
          <Empty
            title="No workstream is under strain."
            body="Every project Husn is reading is in alignment right now."
          />
        ) : (
          <ul className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {bottlenecks.map((p) => (
              <li key={p.id}>
                <BottleneckCard project={p} strain={strainByProject.get(p.id) ?? []} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Workstreams */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "160ms" }}>
        <Section kicker="02" title="Workstreams" />
        {projects.length === 0 ? (
          <Empty title="No workstreams mapped yet." body={<>Connect a tool to give Husn somewhere to read from. <Link href="/connections" style={{ color: "var(--accent)" }} className="font-medium">Open Connections →</Link></>} />
        ) : (
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {projects.map((p) => (
              <li key={p.id}>
                <WorkstreamCard project={p} strain={strainByProject.get(p.id) ?? []} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Critical Path People */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "220ms" }}>
        <Section kicker="03" title="Critical-Path People" />
        <p className="husn-prose mb-6 max-w-[60ch]">
          People appearing across the most workstreams — and named in the open ownership
          questions Husn hasn't been able to resolve. Open a card to see their identities
          and reach out.
        </p>
        <CriticalPeople people={buildCriticalPeople(persons, open)} />
      </section>

      {/* 5. This week's signal */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "280ms" }}>
        <Section kicker="04" title="This week" />
        <WeeklySignal days={weeklyDays(all)} />
      </section>

      {/* 6. Connector Health */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "340ms" }}>
        <Section kicker="05" title="Connector health" />
        <ConnectorHealth connections={connections} />
      </section>
    </main>
  );
}

/* =====================================================
   Section primitive
   ===================================================== */

function Section({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-5">
      <span className="tabular text-[11px] font-medium" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>{kicker}</span>
      <h2 className="husn-heading" style={{ fontSize: 22 }}>{title}</h2>
    </div>
  );
}

/* =====================================================
   Hero text helpers
   ===================================================== */

function stateOfTheOrg(open: Finding[], projectCount: number): string {
  if (projectCount === 0) return "Your organization, ready to be mapped.";
  if (open.length === 0) return "Everything Husn is watching is aligned.";
  const high = open.filter((f) => f.severity === "high").length;
  if (high >= 1) return `${high === 1 ? "One workstream needs" : `${high} workstreams need`} an answer today.`;
  return "A few questions are waiting for someone to move them.";
}

function howWeRead(projects: number, people: number, openCount: number): string {
  if (projects === 0) return "Connect a tool and Husn will start reading what's actually happening — who owns what, what's slipping, and where the disagreements live.";
  const strain = openCount === 0 ? "No active strain right now." : `${openCount} active ${openCount === 1 ? "question" : "questions"} below.`;
  return `Husn is reading ${projects === 1 ? "this workstream" : `${projects} workstreams`} and the ${people} ${people === 1 ? "person" : "people"} moving it. ${strain}`;
}

/* =====================================================
   Compact Pulse (no client interactivity — quick read)
   ===================================================== */

function CompactPulse({
  confidence: conf,
  alignment: alig,
  bottlenecks,
  stale,
}: {
  confidence: number;
  alignment: number;
  bottlenecks: number;
  stale: number;
}) {
  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-[var(--radius-lg)] border"
      style={{ background: "var(--rule)", borderColor: "var(--border)" }}
    >
      <MiniRing label="Confidence" value={conf} />
      <MiniRing label="Alignment" value={alig} />
      <MiniText label="Bottlenecks" value={bottlenecks === 0 ? "None" : String(bottlenecks)} tone={bottlenecks === 0 ? "aligned" : bottlenecks <= 2 ? "uncertain" : "conflict"} />
      <MiniText label="Stale items" value={stale === 0 ? "None" : String(stale)} tone={stale === 0 ? "aligned" : stale <= 3 ? "uncertain" : "conflict"} />
    </div>
  );
}

function MiniRing({ label, value }: { label: string; value: number }) {
  const tone = value >= 75 ? "aligned" : value >= 50 ? "understood" : value >= 30 ? "uncertain" : "conflict";
  const color =
    tone === "aligned" ? "var(--aligned)" :
    tone === "understood" ? "var(--understood)" :
    tone === "uncertain" ? "var(--uncertain)" :
    "var(--conflict)";
  const r = 20;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - value / 100);
  return (
    <div className="p-5 flex items-center gap-4" style={{ background: "var(--panel)" }}>
      <div className="relative shrink-0" style={{ width: 52, height: 52 }}>
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r={r} fill="none" stroke="var(--panel-2)" strokeWidth="5" />
          <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset} transform="rotate(-90 26 26)" />
        </svg>
        <span aria-hidden className="husn-pulse absolute inset-0 m-auto rounded-full" style={{ width: 6, height: 6, background: color, top: 23, left: 23 }} />
      </div>
      <div>
        <p className="husn-eyebrow" style={{ fontSize: 10 }}>{label}</p>
        <p className="mt-1 tabular" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.018em", lineHeight: 1, color }}>
          {value}%
        </p>
      </div>
    </div>
  );
}

function MiniText({ label, value, tone }: { label: string; value: string; tone: "aligned" | "uncertain" | "conflict" }) {
  const color =
    tone === "aligned" ? "var(--aligned)" :
    tone === "uncertain" ? "var(--uncertain)" :
    "var(--conflict)";
  const soft =
    tone === "aligned" ? "var(--aligned-soft)" :
    tone === "uncertain" ? "var(--uncertain-soft)" :
    "var(--conflict-soft)";
  return (
    <div className="p-5 flex items-center gap-4" style={{ background: "var(--panel)" }}>
      <span aria-hidden className="husn-pulse inline-block rounded-full shrink-0" style={{ width: 12, height: 12, background: color, boxShadow: `0 0 0 6px ${soft}` }} />
      <div>
        <p className="husn-eyebrow" style={{ fontSize: 10 }}>{label}</p>
        <p className="mt-1 tabular" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.018em", lineHeight: 1.1, color }}>
          {value}
        </p>
      </div>
    </div>
  );
}

/* =====================================================
   Workstream / Bottleneck cards
   ===================================================== */

function BottleneckCard({ project, strain }: { project: Project; strain: Finding[] }) {
  const top = strain.sort((a, b) => sevWeight(b.severity) - sevWeight(a.severity))[0] ?? null;
  const conf = projectConfidence(strain);
  const tone = conf >= 70 ? "uncertain" : "conflict";
  const color = tone === "conflict" ? "var(--conflict)" : "var(--uncertain)";

  const ctx: ReachOutContext | null = top ? {
    who: "The likely owner",
    why: `${project.name} has ${strain.length} open ${strain.length === 1 ? "concern" : "concerns"} right now. The most consequential is below.`,
    about: `${project.name} — ${strain.length} open`,
    draft: `Hey — saw ${strain.length} open ${strain.length === 1 ? "concern" : "concerns"} on ${project.name}. Could you give me a quick read on where we are? Want to make sure plans are aligned.`,
    via: "slack",
  } : null;

  return (
    <article
      className="h-full flex flex-col justify-between rounded-[var(--radius-lg)] border p-5"
      style={{ borderColor: color, background: "var(--panel)", boxShadow: "var(--shadow-sm)" }}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-mono uppercase" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>{project.slug}</p>
            <h3 className="husn-heading mt-1" style={{ fontSize: 18 }}>{project.name}</h3>
          </div>
          <span aria-hidden className="husn-pulse inline-block rounded-full shrink-0 mt-1" style={{ width: 12, height: 12, background: color, boxShadow: `0 0 0 5px ${tone === "conflict" ? "var(--conflict-soft)" : "var(--uncertain-soft)"}` }} />
        </div>

        <div className="mt-4 flex items-center gap-3 max-w-[320px]">
          <p className="husn-eyebrow" style={{ fontSize: 10 }}>Confidence</p>
          <div className="flex-1 rounded-full overflow-hidden" style={{ height: 5, background: "var(--panel-2)" }}>
            <div className="h-full" style={{ width: `${conf}%`, background: color }} />
          </div>
          <p className="tabular" style={{ fontSize: 13, fontWeight: 600, color }}>{conf}%</p>
        </div>

        <p className="mt-4 text-[13.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>
          {strain.length} open · {kindBreakdown(strain)}.
        </p>
        {top ? (
          <p className="mt-2 text-[12.5px]" style={{ color: "var(--muted)" }}>
            Top concern: <span style={{ color: "var(--text)", fontWeight: 500 }}>{cleanTitle(top)}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/explore?lens=risks`}
          className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
          style={{ borderColor: "var(--border-strong)", background: "var(--panel)", color: "var(--text)" }}
        >
          Investigate
        </Link>
        {ctx ? <ReachOutButton context={ctx} variant="secondary" size="sm" /> : null}
      </div>
    </article>
  );
}

function WorkstreamCard({ project, strain }: { project: Project; strain: Finding[] }) {
  const conf = projectConfidence(strain);
  const tone =
    strain.length === 0 ? "aligned" :
    strain.length <= 2 ? "uncertain" :
    "conflict";
  const color =
    tone === "aligned" ? "var(--aligned)" :
    tone === "uncertain" ? "var(--uncertain)" :
    "var(--conflict)";
  const soft =
    tone === "aligned" ? "var(--aligned-soft)" :
    tone === "uncertain" ? "var(--uncertain-soft)" :
    "var(--conflict-soft)";

  return (
    <Link
      href={`/explore?lens=projects`}
      className="block h-full rounded-[var(--radius)] border px-5 py-5 husn-lift"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-mono uppercase" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>{project.slug}</p>
          <h3 className="husn-heading mt-1" style={{ fontSize: 18 }}>{project.name}</h3>
          <p className="mt-2 text-[13.5px]" style={{ color: "var(--muted)" }}>
            {strain.length === 0 ? "No active concerns." : `${strain.length} open · ${kindBreakdown(strain)}`}
          </p>
        </div>
        <span aria-hidden className="husn-pulse inline-block rounded-full shrink-0 mt-1" style={{ width: 11, height: 11, background: color, boxShadow: `0 0 0 5px ${soft}` }} />
      </div>

      <div className="mt-4 flex items-center gap-3 max-w-[260px]">
        <p className="husn-eyebrow" style={{ fontSize: 10 }}>Conf</p>
        <div className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: "var(--panel-2)" }}>
          <div className="h-full" style={{ width: `${conf}%`, background: color }} />
        </div>
        <p className="tabular" style={{ fontSize: 12, fontWeight: 600, color }}>{conf}%</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {project.scopes.slice(0, 4).map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]" style={{ borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--muted)" }}>
            <span>{SOURCE_LABEL[s.source] ?? s.source}</span>
            <span aria-hidden style={{ opacity: 0.4 }}>·</span>
            <span className="font-medium" style={{ color: "var(--text-2)" }}>{s.id}</span>
          </span>
        ))}
      </div>
    </Link>
  );
}

/* =====================================================
   Connector Health
   ===================================================== */

function ConnectorHealth({ connections }: { connections: ConnectionRow[] }) {
  if (connections.length === 0) {
    return (
      <Empty title="No connectors yet." body={<>Connect a source from <Link href="/connections" style={{ color: "var(--accent)" }} className="font-medium">Connections →</Link></>} />
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {connections.map((c) => {
        const tone =
          c.token_status === "ok" ? "aligned" :
          c.token_status === "expiring-soon" ? "uncertain" :
          "conflict";
        const color = tone === "aligned" ? "var(--aligned)" : tone === "uncertain" ? "var(--uncertain)" : "var(--conflict)";
        const soft = tone === "aligned" ? "var(--aligned-soft)" : tone === "uncertain" ? "var(--uncertain-soft)" : "var(--conflict-soft)";
        return (
          <li key={c.id}>
            <Link
              href="/connections"
              className="block rounded-[var(--radius)] border px-4 py-4 husn-lift"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <div className="flex items-center gap-3">
                <span aria-hidden className="husn-pulse inline-block rounded-full shrink-0" style={{ width: 10, height: 10, background: color, boxShadow: `0 0 0 5px ${soft}` }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium truncate">{SOURCE_LABEL[c.source] ?? c.source}</p>
                  <p className="text-[11.5px] truncate" style={{ color: "var(--muted)" }}>
                    {c.account_label || c.source} · last sync {timeAgo(c.last_raw_fetched_at)}
                  </p>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed px-6 py-10" style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}>
      <p className="text-[14.5px] font-medium">{title}</p>
      <div className="mt-2 text-[13px] leading-relaxed max-w-[58ch]" style={{ color: "var(--muted)" }}>{body}</div>
    </div>
  );
}

/* =====================================================
   Pure helpers
   ===================================================== */

const SEV = { high: 12, medium: 5, low: 1 } as const;
function sevWeight(s: "high" | "medium" | "low"): number { return SEV[s]; }

function orgConfidence(open: Finding[]): number {
  const w = open.reduce((acc, f) => acc + SEV[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - w));
}
function orgAlignment(open: Finding[]): number {
  const drift = open.filter((f) => f.rule_id === "R-DATE-1" || f.rule_id === "R-STATUS-1").length;
  return Math.max(0, Math.min(100, 100 - drift * 9));
}
function staleCount(open: Finding[]): number {
  const cut = Date.now() - 14 * 86400 * 1000;
  return open.filter((f) => Date.parse(f.opened_at) < cut).length;
}
function projectConfidence(strain: Finding[]): number {
  const w = strain.reduce((acc, f) => acc + SEV[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - w * 1.4));
}
function kindBreakdown(strain: Finding[]): string {
  const kinds = new Set(strain.map((f) => f.rule_id));
  const parts: string[] = [];
  if (kinds.has("R-DATE-1")) parts.push("date conflicts");
  if (kinds.has("R-STATUS-1")) parts.push("status drift");
  if (kinds.has("R-OWNER-1")) parts.push("ownership gaps");
  if ([...kinds].some((k) => k.startsWith("R-DEP-"))) parts.push("dependencies");
  if ([...kinds].some((k) => k.startsWith("AGENT-FINDING-"))) parts.push("patterns");
  return parts.length ? parts.join(", ") : "concerns";
}
function prettyKey(key?: string | null): string {
  if (!key) return "this";
  const last = key.split("/").pop() || key;
  return last.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function cleanTitle(f: Finding): string {
  const k = prettyKey(f.details?.key);
  if (f.rule_id === "R-DATE-1") return `${k} conflict`;
  if (f.rule_id === "R-STATUS-1") return `${k} drift`;
  if (f.rule_id === "R-OWNER-1") return `${k} unclear`;
  return f.summary.split(":")[0].split(" (")[0].trim() || "Concern";
}
function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function buildCriticalPeople(persons: Person[], openFindings: Finding[]): CriticalPerson[] {
  // ownershipLoad: count of R-OWNER-1 findings whose distinct_values mentions
  // this person's name or email.
  const ownerFindings = openFindings.filter((f) => f.rule_id === "R-OWNER-1");

  return persons.map((p): CriticalPerson => {
    const name = p.primary_name ?? p.primary_email ?? `#${p.id}`;
    const initials = (name.match(/\b[\p{L}\p{N}]/gu) || []).slice(0, 2).join("").toUpperCase() || "·";

    const candidates = [name.toLowerCase(), (p.primary_email ?? "").toLowerCase()].filter(Boolean);
    const ownershipLoad = ownerFindings.filter((f) =>
      (f.details?.distinct_values ?? []).some((v) =>
        candidates.some((c) => c && v.toLowerCase().includes(c)),
      ),
    ).length;

    const tools = p.identities.map((i) => SOURCE_LABEL[i.source] ?? i.source);
    const touches = tools.length === 0
      ? "Identity resolved across no tools yet."
      : `Active across ${tools.slice(0, 3).join(", ")}${tools.length > 3 ? ` and ${tools.length - 3} more` : ""}.`;

    return {
      id: p.id,
      name,
      email: p.primary_email,
      initials,
      identities: p.identities,
      ownershipLoad,
      touches,
    };
  });
}

function weeklyDays(allFindings: Finding[]): SignalDay[] {
  const days: SignalDay[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 6; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, "0");
    const dd = String(day.getDate()).padStart(2, "0");
    const iso = `${yyyy}-${mm}-${dd}`;
    const dayLabel = day.toLocaleDateString(undefined, { weekday: "short" });
    days.push({ date: iso, opened: 0, closed: 0, dayLabel });
  }

  for (const f of allFindings) {
    const tOpen = Date.parse(f.opened_at);
    if (Number.isFinite(tOpen)) {
      const idx = dayIdx(tOpen, today);
      if (idx >= 0 && idx < days.length) days[idx].opened += 1;
    }
    if (f.closed_at) {
      const tClose = Date.parse(f.closed_at);
      if (Number.isFinite(tClose)) {
        const idx = dayIdx(tClose, today);
        if (idx >= 0 && idx < days.length) days[idx].closed += 1;
      }
    }
  }

  return days;
}

function dayIdx(t: number, today: Date): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const dayMs = 86400 * 1000;
  const diff = Math.floor((d.getTime() - today.getTime()) / dayMs);
  // today is index 6, yesterday 5, ... 6 days ago = 0
  return 6 + diff;
}
