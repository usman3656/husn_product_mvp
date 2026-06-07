import Link from "next/link";

import { FETCH_INIT } from "@/lib/fetch-init";

/* ============================================================
   Organization — a strategic view, not a database snapshot.
   No "22 people / 168 signals" stats. Reads as: here is how
   work flows through your org, where it concentrates, and
   where Husn sees strain.
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
  details: { key: string; per_source: Record<string, { artifact_title?: string | null }[]> } | null;
};

async function safeFetch<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url, FETCH_INIT); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

const SOURCE_LABEL: Record<string, string> = { jira: "Jira", slack: "Slack", google: "Google", microsoft: "Microsoft" };

export default async function OrganizationPage() {
  const [projectsRes, personsRes, findingsRes] = await Promise.all([
    safeFetch<{ projects: Project[] }>(`${SERVER_API_URL}/api/graph/projects`),
    safeFetch<{ persons: Person[] }>(`${SERVER_API_URL}/api/graph/persons?limit=200`),
    safeFetch<{ items: Finding[] }>(`${SERVER_API_URL}/api/findings?status=open&limit=80`),
  ]);

  const projects = projectsRes?.projects ?? [];
  const persons = personsRes?.persons ?? [];
  const findings = findingsRes?.items ?? [];

  // Per-project: count related open findings as a strain signal
  const strainByProject = new Map<number, Finding[]>();
  for (const p of projects) {
    const related = findings.filter((f) =>
      Object.values(f.details?.per_source ?? {}).some((arr) =>
        arr.some((ev) => (ev.artifact_title ?? "").toLowerCase().includes(p.slug.toLowerCase())),
      ),
    );
    strainByProject.set(p.id, related);
  }

  return (
    <main className="mx-auto px-6 lg:px-12 pt-12 pb-32" style={{ maxWidth: 1100 }}>
      <header className="husn-rise" style={{ maxWidth: 720 }}>
        <p className="husn-eyebrow">Organization</p>
        <h1 className="husn-display mt-4">{narrate(projects.length, persons.length)}</h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          {narrateBody(projects.length, persons.length, findings.length)}
        </p>
      </header>

      {/* Workstreams — projects as strategic blocks, with the strain Husn
          sees on each one and the sources of truth involved. */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "60ms" }}>
        <div className="flex items-baseline gap-3 mb-5">
          <span className="tabular text-[11px] font-medium" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>01</span>
          <h2 className="husn-heading" style={{ fontSize: 22 }}>Workstreams</h2>
        </div>
        {projects.length === 0 ? (
          <Empty title="No workstreams mapped yet." body={<>Connect a tool to give Husn somewhere to read from. <Link href="/connections" style={{ color: "var(--accent)" }} className="font-medium">Open Connections →</Link></>} />
        ) : (
          <ul className="space-y-3">
            {projects.map((p) => <WorkstreamRow key={p.id} project={p} strain={strainByProject.get(p.id) ?? []} />)}
          </ul>
        )}
      </section>

      {/* How work flows — a small editorial diagram showing connector → graph → understanding */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "120ms" }}>
        <div className="flex items-baseline gap-3 mb-5">
          <span className="tabular text-[11px] font-medium" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>02</span>
          <h2 className="husn-heading" style={{ fontSize: 22 }}>How work flows</h2>
        </div>
        <FlowDiagram sources={uniqSources(projects)} />
      </section>

      {/* People — identity-resolution as the headline, not the count */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "180ms" }}>
        <div className="flex items-baseline gap-3 mb-5">
          <span className="tabular text-[11px] font-medium" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>03</span>
          <h2 className="husn-heading" style={{ fontSize: 22 }}>People in the picture</h2>
        </div>
        <p className="husn-prose mb-6 max-w-[60ch]">
          Husn resolves the same person across their Slack handle, Jira account, and email aliases —
          so when it says "the owner", it means a person, not an account.
        </p>
        {persons.length === 0 ? (
          <Empty title="No people resolved yet." body="They appear here as Husn reads activity." />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {persons.slice(0, 18).map((p) => <PersonRow key={p.id} person={p} />)}
          </ul>
        )}
      </section>
    </main>
  );
}

function narrate(projects: number, people: number): string {
  if (projects === 0 && people === 0) return "Your organization, mapped.";
  if (projects === 0) return `Your team, ${people === 1 ? "one person" : `${people} people`} so far.`;
  return `${projects === 1 ? "One workstream" : `${projects} workstreams`}, and the people moving them.`;
}
function narrateBody(projects: number, people: number, findings: number): string {
  if (projects === 0) return "Connect a tool and Husn will start mapping how work flows through your org.";
  const strain = findings === 0 ? "Everything looks aligned today." : `${findings} ${findings === 1 ? "concern is" : "concerns are"} active across the picture.`;
  return `Husn is reading the work that touches ${projects === 1 ? "this workstream" : `these ${projects} workstreams`}, the ${people} ${people === 1 ? "person" : "people"} moving it, and the tools where decisions land. ${strain}`;
}

function uniqSources(projects: Project[]): string[] {
  const set = new Set<string>();
  for (const p of projects) for (const s of p.scopes) set.add(s.source);
  return [...set];
}

function WorkstreamRow({ project, strain }: { project: Project; strain: Finding[] }) {
  const tone = strain.length === 0 ? "aligned" : strain.length <= 2 ? "uncertain" : "conflict";
  const colorVar = tone === "aligned" ? "var(--aligned)" : tone === "uncertain" ? "var(--uncertain)" : "var(--conflict)";
  const softVar = tone === "aligned" ? "var(--aligned-soft)" : tone === "uncertain" ? "var(--uncertain-soft)" : "var(--conflict-soft)";

  return (
    <li>
      <Link
        href={`/explore?lens=projects`}
        className="block rounded-[var(--radius)] border px-6 py-5 husn-lift"
        style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      >
        <div className="flex items-start gap-5">
          <span aria-hidden className="mt-1 inline-block rounded-full husn-pulse" style={{ width: 12, height: 12, background: colorVar, boxShadow: `0 0 0 6px ${softVar}` }} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-[10.5px] font-mono uppercase" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>{project.slug}</p>
            </div>
            <h3 className="husn-heading mt-1" style={{ fontSize: 19 }}>{project.name}</h3>
            <p className="mt-2 text-[14px]" style={{ color: "var(--text-2)" }}>
              {strainNarration(strain)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {project.scopes.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]" style={{ borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--muted)" }} title={`${s.kind}: ${s.id}`}>
                  <span>{SOURCE_LABEL[s.source] ?? s.source}</span>
                  <span aria-hidden style={{ opacity: 0.4 }}>·</span>
                  <span className="font-medium" style={{ color: "var(--text-2)" }}>{s.id}</span>
                </span>
              ))}
            </div>
          </div>
          <span aria-hidden className="shrink-0 self-center text-[15px]" style={{ color: "var(--muted)" }}>→</span>
        </div>
      </Link>
    </li>
  );
}

function strainNarration(strain: Finding[]): string {
  if (strain.length === 0) return "No active concerns. Husn is watching the activity here.";
  const kinds = new Set(strain.map((f) => f.rule_id));
  const parts: string[] = [];
  if ([...kinds].some((k) => k === "R-DATE-1")) parts.push("date conflicts");
  if ([...kinds].some((k) => k === "R-STATUS-1")) parts.push("status drift");
  if ([...kinds].some((k) => k === "R-OWNER-1")) parts.push("unclear ownership");
  if ([...kinds].some((k) => k.startsWith("R-DEP-"))) parts.push("dependency strain");
  const summary = parts.length > 0 ? parts.join(", ") : "concerns";
  return `${strain.length} open — ${summary}.`;
}

/* A small editorial flow diagram: sources → understanding → action. No node-link spaghetti. */
function FlowDiagram({ sources }: { sources: string[] }) {
  const visible = sources.slice(0, 5);
  return (
    <div
      className="rounded-[var(--radius-lg)] border p-8 lg:p-12"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex flex-wrap items-center gap-4 lg:gap-8">
        {/* Sources column */}
        <div className="flex-1 min-w-[180px]">
          <p className="husn-eyebrow">Sources of truth</p>
          <ul className="mt-3 space-y-1.5">
            {visible.length === 0 ? (
              <li className="text-[13.5px]" style={{ color: "var(--muted)" }}>None connected.</li>
            ) : visible.map((s) => (
              <li key={s} className="text-[14.5px] font-medium" style={{ color: "var(--text)" }}>
                {SOURCE_LABEL[s] ?? s}
              </li>
            ))}
          </ul>
        </div>

        <Arrow />

        {/* Husn column */}
        <div className="flex-1 min-w-[180px]">
          <p className="husn-eyebrow">Husn reads → understands</p>
          <ul className="mt-3 space-y-1.5 text-[14.5px]" style={{ color: "var(--text)" }}>
            <li>Claims · evidence · owners</li>
            <li>Dates · statuses · dependencies</li>
            <li>Decisions · patterns</li>
          </ul>
        </div>

        <Arrow />

        {/* Outcome column */}
        <div className="flex-1 min-w-[180px]">
          <p className="husn-eyebrow">You move</p>
          <ul className="mt-3 space-y-1.5 text-[14.5px]" style={{ color: "var(--text)" }}>
            <li>Briefing — what to know</li>
            <li>Investigations — what to verify</li>
            <li>Reach Out For Me — what to send</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="hidden lg:inline-flex items-center" style={{ color: "var(--muted-2)" }}>
      <svg width="36" height="14" viewBox="0 0 36 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 7h28M24 2l6 5-6 5" />
      </svg>
    </span>
  );
}

function PersonRow({ person }: { person: Person }) {
  const name = person.primary_name ?? person.primary_email ?? `#${person.id}`;
  const initials = (name.match(/\b[\p{L}\p{N}]/gu) || []).slice(0, 2).join("").toUpperCase() || "·";
  return (
    <li className="rounded-[var(--radius)] border p-4 husn-lift" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold shrink-0" style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)" }}>
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{name}</p>
          {person.primary_email ? <p className="truncate text-[12px]" style={{ color: "var(--muted)" }}>{person.primary_email}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1">
            {person.identities.slice(0, 4).map((idt, i) => (
              <span key={i} className="rounded-md border px-1.5 py-0.5 font-mono text-[9.5px]" style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--panel-2)" }}>
                {SOURCE_LABEL[idt.source] ?? idt.source}
              </span>
            ))}
          </div>
        </div>
      </div>
    </li>
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
