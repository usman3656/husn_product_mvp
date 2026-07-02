import Link from "next/link";

import { OrgMatrix, type MatrixEdge, type MatrixPerson, type MatrixProject } from "@/components/org-matrix";
import { serverJson } from "@/lib/api";

/* ============================================================
   Organization — the Organizational Digital Twin.
   Answers: "How does this organization work?"

   Sections, in order:
     1. Workstreams           (the work the org is doing)
     2. Organizational Map    (People × Workstreams matrix)
     3. People in the picture (context, not directory)
     4. Decision Network      (where decisions live)
     5. Sources of Truth      (quiet, secondary)

   Tone: editorial, calm, premium. No metric blocks. No counts
   of "signals". No risk language. This page is not a briefing.
   ============================================================ */

type Project = {
  id: number; slug: string; name: string;
  scopes: { source: string; kind: string; id: string }[];
  artifact_count: number;
};
type Person = {
  id: number; primary_name: string | null; primary_email: string | null;
  identities: { source: string; display_name: string | null; email: string | null }[];
};
type PeopleProjectEdge = {
  person_id: number; project_id: number;
  total: number;
  dominant_role: "author" | "assignee" | "mention" | "watcher" | string;
};
type Finding = {
  id: number; rule_id: string; severity: "low" | "medium" | "high"; status: "open" | "closed" | "snoozed";
  summary: string;
  details: { key: string; distinct_values: string[]; per_source: Record<string, { artifact_title?: string | null }[]> } | null;
  opened_at: string;
};
type ConnectionRow = {
  id: number; source: string; account_label: string | null;
  artifact_count: number;
};

const SOURCE_LABEL: Record<string, string> = { epic: "Epic", pacs: "PACS", orboard: "OR Board", pager: "Secure Chat", labs: "Labs", sched: "Scheduling", slack: "Slack", email: "Email" };

export default async function OrganizationPage() {
  const [projectsRes, personsRes, edgesRes, findingsRes, connectionsRes] = await Promise.all([
    serverJson<{ projects: Project[] }>("/api/graph/projects"),
    serverJson<{ persons: Person[] }>("/api/graph/persons?limit=200"),
    serverJson<{ items: PeopleProjectEdge[] }>("/api/graph/people-projects"),
    serverJson<{ items: Finding[] }>("/api/findings?status=open&limit=200"),
    serverJson<{ items: ConnectionRow[] }>("/api/connections"),
  ]);

  const projects = projectsRes?.projects ?? [];
  const persons = personsRes?.persons ?? [];
  const edges = edgesRes?.items ?? [];
  const findings = findingsRes?.items ?? [];
  const connections = connectionsRes?.items ?? [];

  // Awaiting first sync: don't pretend the org is "well-mapped" when nothing
  // has been read yet. One CTA, then the sections render their own empty
  // states under it (the existing Empty components are already calm).
  const awaiting = projects.length === 0 && persons.length === 0 && connections.length === 0;
  if (awaiting) {
    return (
      <main className="mx-auto px-6 lg:px-12 pt-12 pb-32" style={{ maxWidth: 1100 }}>
        <header className="husn-rise" style={{ maxWidth: 760 }}>
          <p className="husn-eyebrow">Organization</p>
          <h1 className="husn-display mt-4">Your organization, unmapped.</h1>
          <p className="husn-prose mt-5 max-w-[60ch]">
            Husn maps the work your team is doing and the people moving it from
            the tools you connect. Once a source is wired, this page fills in:
            workstreams, the people × workstreams matrix, decisions in motion.
          </p>
        </header>
        <section className="mt-14 husn-rise" style={{ animationDelay: "60ms" }}>
          <article
            className="rounded-[var(--radius-xl)] border p-10 lg:p-14"
            style={{ borderColor: "var(--border)", background: "var(--panel)", boxShadow: "var(--shadow-md)" }}
          >
            <p className="husn-eyebrow">Get started</p>
            <h2 className="husn-title mt-4" style={{ fontSize: 32, lineHeight: 1.14, maxWidth: "22ch" }}>
              Connect a tool to begin.
            </h2>
            <p className="husn-prose mt-5 max-w-[60ch]">
              Slack, Jira, Google, or Microsoft — pick the source where your
              team&apos;s work actually lives. Within an hour of the first sync,
              this page maps people, workstreams, and the relationships between them.
            </p>
            <div className="mt-8">
              <Link
                href="/connections"
                className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[14px] font-semibold"
                style={{ background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" }}
              >
                Connect tools →
              </Link>
            </div>
          </article>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto px-6 lg:px-12 pt-12 pb-32" style={{ maxWidth: 1100 }}>
      {/* Editorial header */}
      <header className="husn-rise" style={{ maxWidth: 760 }}>
        <p className="husn-eyebrow">Organization</p>
        <h1 className="husn-display mt-4">Your floor, mapped.</h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          A living view of the areas you cover, the people you work with, and how
          they all connect. This is the digital twin of your service —
          not today&apos;s briefing, not the inbox.
        </p>
      </header>

      {/* 1. Areas */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "60ms" }}>
        <Kicker n="01" title="Areas" sub="OR, ICU, ward, ED, tumour board, and clinic." />
        {projects.length === 0 ? (
          <Empty
            title="No workstreams mapped yet."
            body={<>Connect a tool to give Husn somewhere to read from. <Link href="/connections" style={{ color: "var(--accent)" }} className="font-medium">Open Connections →</Link></>}
          />
        ) : (
          <ul className="space-y-3">
            {projects.map((p) => (
              <li key={p.id}>
                <WorkstreamBlock
                  project={p}
                  people={topPeopleForProject(p.id, persons, edges)}
                  decisions={decisionsAround(p, findings)}
                  dependencies={dependenciesAround(p, findings)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. Organizational Map — People × Workstreams */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "120ms" }}>
        <Kicker n="02" title="Care-team map" sub="How your team connects to the areas." />
        <OrgMatrix
          people={persons.map((p): MatrixPerson => ({
            id: p.id,
            name: p.primary_name ?? p.primary_email ?? `#${p.id}`,
            email: p.primary_email,
            initials: initialsOf(p.primary_name ?? p.primary_email ?? `#${p.id}`),
            identities: p.identities.map((i) => ({ source: i.source })),
          }))}
          projects={projects.map((p): MatrixProject => ({ id: p.id, slug: p.slug, name: p.name }))}
          edges={edges as MatrixEdge[]}
        />
      </section>

      {/* 3. People in the picture */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "180ms" }}>
        <Kicker n="03" title="People in the picture" sub="Context, not a directory." />
        <PeopleContext persons={persons} projects={projects} edges={edges} />
      </section>

      {/* 4. Decision Network */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "240ms" }}>
        <Kicker n="04" title="Decision network" sub="Where the choices being made today live." />
        <DecisionNetwork projects={projects} findings={findings} edges={edges} persons={persons} />
      </section>

      {/* 5. Sources of Truth (quiet) */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "300ms" }}>
        <Kicker n="05" title="Sources of truth" sub="Supporting systems, not the stars." />
        <SourcesStrip connections={connections} />
      </section>
    </main>
  );
}

/* =====================================================
   Kicker
   ===================================================== */

function Kicker({ n, title, sub }: { n: string; title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-5">
      <span className="tabular text-[11px] font-medium" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>{n}</span>
      <div>
        <h2 className="husn-heading" style={{ fontSize: 22 }}>{title}</h2>
        {sub ? <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>{sub}</p> : null}
      </div>
    </div>
  );
}

/* =====================================================
   1. Workstream block — editorial, structured.
   ===================================================== */

function WorkstreamBlock({
  project,
  people,
  decisions,
  dependencies,
}: {
  project: Project;
  people: { name: string; role: string }[];
  decisions: string[];
  dependencies: string[];
}) {
  return (
    <article
      className="rounded-[var(--radius-lg)] border p-6 lg:p-7"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <header className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10.5px] font-mono uppercase" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>{project.slug}</p>
          <h3 className="husn-heading mt-1.5" style={{ fontSize: 22 }}>{project.name}</h3>
        </div>
        <p className="husn-meta shrink-0">
          {project.scopes.length} {project.scopes.length === 1 ? "surface" : "surfaces"}
        </p>
      </header>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-5">
        <ColumnLabel label="Owners" empty="Owner unconfirmed">
          {people.filter((p) => p.role === "author" || p.role === "assignee").slice(0, 3).map((p, i) => (
            <PersonLine key={i} name={p.name} role={p.role} />
          ))}
        </ColumnLabel>

        <ColumnLabel label="Teams involved" empty="—">
          {teamLines(project, people).map((t, i) => (
            <li key={i} className="text-[13.5px]" style={{ color: "var(--text-2)" }}>{t}</li>
          ))}
        </ColumnLabel>

        <ColumnLabel label="Dependencies" empty="None visible">
          {dependencies.length === 0 ? null : dependencies.slice(0, 3).map((d, i) => (
            <li key={i} className="text-[13.5px]" style={{ color: "var(--text-2)" }}>{d}</li>
          ))}
        </ColumnLabel>

        <ColumnLabel label="Connected decisions" empty="No decisions surfaced yet">
          {decisions.length === 0 ? null : decisions.slice(0, 3).map((d, i) => (
            <li key={i} className="text-[13.5px]" style={{ color: "var(--text-2)" }}>{d}</li>
          ))}
        </ColumnLabel>
      </div>
    </article>
  );
}

function ColumnLabel({ label, empty, children }: { label: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div>
      <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>{label}</p>
      {has ? (
        <ul className="mt-3 space-y-1.5">{children}</ul>
      ) : (
        <p className="mt-3 text-[13px]" style={{ color: "var(--muted)" }}>{empty}</p>
      )}
    </div>
  );
}

function PersonLine({ name, role }: { name: string; role: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold shrink-0"
        style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)" }}
      >
        {initialsOf(name)}
      </span>
      <span className="text-[13.5px] font-medium truncate" style={{ color: "var(--text)" }}>{name}</span>
      <span className="text-[11.5px]" style={{ color: "var(--muted)" }}>· {prettyRole(role)}</span>
    </li>
  );
}

function teamLines(project: Project, people: { name: string; role: string }[]): string[] {
  // Use the sources of truth as a proxy for teams ("Engineering" via Jira,
  // "Conversation" via Slack, etc. — but we keep the language source-led,
  // since we don't have first-class team data yet.
  const teams = new Set<string>();
  for (const s of project.scopes) teams.add(SOURCE_LABEL[s.source] ?? s.source);
  // Add a count of contributors as the last "team" line if we have any.
  const lines = [...teams].map((t) => `${t} surface`);
  if (people.length > 0) lines.push(`${people.length} ${people.length === 1 ? "contributor" : "contributors"} active`);
  return lines;
}

function prettyRole(role: string): string {
  if (role === "author") return "Author";
  if (role === "assignee") return "Assignee";
  if (role === "watcher") return "Watching";
  if (role === "mention") return "Mentioned";
  return role;
}

function topPeopleForProject(projectId: number, persons: Person[], edges: PeopleProjectEdge[]): { name: string; role: string }[] {
  const relevant = edges.filter((e) => e.project_id === projectId).sort((a, b) => b.total - a.total).slice(0, 6);
  return relevant.flatMap((e) => {
    const p = persons.find((x) => x.id === e.person_id);
    if (!p) return [];
    return [{ name: p.primary_name ?? p.primary_email ?? `#${p.id}`, role: e.dominant_role }];
  });
}

function decisionsAround(project: Project, findings: Finding[]): string[] {
  // We don't have first-class decisions yet; surface as "decisions in flight"
  // anything that looks like a status / commitment change that touches this project.
  const slug = project.slug.toLowerCase();
  const inFlight = findings
    .filter((f) => f.rule_id === "R-STATUS-1")
    .filter((f) =>
      Object.values(f.details?.per_source ?? {}).some((arr) =>
        arr.some((ev) => (ev.artifact_title ?? "").toLowerCase().includes(slug)),
      ),
    );
  return inFlight.slice(0, 3).map((f) => decisionPhrase(f));
}

function dependenciesAround(project: Project, findings: Finding[]): string[] {
  const slug = project.slug.toLowerCase();
  const deps = findings
    .filter((f) => f.rule_id.startsWith("R-DEP-"))
    .filter((f) =>
      Object.values(f.details?.per_source ?? {}).some((arr) =>
        arr.some((ev) => (ev.artifact_title ?? "").toLowerCase().includes(slug)),
      ),
    );
  return deps.slice(0, 3).map((f) => f.summary.split(":")[0].split(" (")[0].trim());
}

function decisionPhrase(f: Finding): string {
  const k = prettyKey(f.details?.key);
  if (f.rule_id === "R-STATUS-1") return `${k} — being decided across sources`;
  if (f.rule_id === "R-DATE-1") return `${k} — date being settled`;
  return f.summary.split(":")[0].split(" (")[0].trim();
}

function prettyKey(key?: string | null): string {
  if (!key) return "this";
  const last = key.split("/").pop() || key;
  return last.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function initialsOf(name: string): string {
  return (name.match(/\b[\p{L}\p{N}]/gu) || []).slice(0, 2).join("").toUpperCase() || "·";
}

/* =====================================================
   3. People in the picture — editorial cards, no directory.
   ===================================================== */

function PeopleContext({
  persons,
  projects,
  edges,
}: {
  persons: Person[];
  projects: Project[];
  edges: PeopleProjectEdge[];
}) {
  // For each person, derive a single editorial line ("Touches 3 workstreams",
  // "Owns 2 dependencies", etc.) from edges. Show top 12 by total touches.
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  type Card = { p: Person; line: string; workstreams: string[]; total: number };

  const cards: Card[] = persons
    .map((p): Card => {
      const myEdges = edges.filter((e) => e.person_id === p.id && projectMap.has(e.project_id));
      const ws = myEdges
        .map((e) => projectMap.get(e.project_id)?.name)
        .filter((x): x is string => !!x);
      const total = myEdges.reduce((acc, e) => acc + e.total, 0);
      const owns = myEdges.filter((e) => e.dominant_role === "author" || e.dominant_role === "assignee").length;
      const mentions = myEdges.filter((e) => e.dominant_role === "mention").length;

      let line = "";
      if (ws.length === 0) line = "Not yet placed in any workstream.";
      else if (owns >= 2) line = `Owns work across ${owns} workstreams.`;
      else if (owns === 1) line = `Owns work on ${projectMap.get(myEdges.find((e) => e.dominant_role === "author" || e.dominant_role === "assignee")!.project_id)?.name ?? "a workstream"}.`;
      else if (ws.length === 1) line = `Active on ${ws[0]}.`;
      else if (mentions >= 2) line = `Referenced across ${ws.length} workstreams.`;
      else line = `Touches ${ws.length} workstreams.`;

      return { p, line, workstreams: ws.slice(0, 3), total };
    })
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  if (cards.length === 0) {
    return (
      <Empty
        title="No one is in the picture yet."
        body="People appear here as Husn reads activity and resolves them across tools."
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {cards.map((c) => {
        const name = c.p.primary_name ?? c.p.primary_email ?? `#${c.p.id}`;
        return (
          <li
            key={c.p.id}
            className="rounded-[var(--radius)] border p-5"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold shrink-0"
                style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)" }}
              >
                {initialsOf(name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-medium" style={{ color: "var(--text)" }}>{name}</p>
                <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>{c.line}</p>
                {c.workstreams.length > 0 ? (
                  <p className="mt-1.5 truncate text-[11.5px]" style={{ color: "var(--muted)" }}>
                    {c.workstreams.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* =====================================================
   4. Decision Network — where decisions live + who influences.
   ===================================================== */

function DecisionNetwork({
  projects,
  findings,
  edges,
  persons,
}: {
  projects: Project[];
  findings: Finding[];
  edges: PeopleProjectEdge[];
  persons: Person[];
}) {
  // Today's first-class signal closest to "a decision being made" =
  // status/scope/dependency claims that have ambiguity (R-STATUS-1, R-DEP-*, agent commitments).
  // We surface up to ~6 ongoing decisions, each with the project they belong to and
  // the people most likely influencing them.
  const decisions = findings.filter(
    (f) => f.rule_id === "R-STATUS-1" || f.rule_id.startsWith("R-DEP-") || f.rule_id.startsWith("AGENT-FINDING-")
  ).slice(0, 6);

  if (decisions.length === 0) {
    return (
      <Empty
        title="No decisions in flight right now."
        body="Husn surfaces decisions as it sees status shifts, dependencies forming, and commitments being made across your tools. This view will grow as deterministic rules expand."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {decisions.map((f) => {
        const proj = guessProjectFor(f, projects);
        const influencers = proj ? topPeopleForProject(proj.id, persons, edges).slice(0, 3) : [];
        return (
          <li
            key={f.id}
            className="rounded-[var(--radius)] border p-5"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="husn-eyebrow" style={{ fontSize: 10.5 }}>
                  {f.rule_id === "R-STATUS-1" ? "Status being decided"
                    : f.rule_id.startsWith("R-DEP-") ? "Dependency in motion"
                    : "Pattern flagged"}
                </p>
                <h4 className="mt-1.5 text-[16px] font-medium" style={{ color: "var(--text)" }}>
                  {decisionPhrase(f)}
                </h4>
                {proj ? (
                  <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
                    Lives in {proj.name}.
                  </p>
                ) : null}
              </div>
              {influencers.length > 0 ? (
                <div className="shrink-0">
                  <p className="husn-eyebrow" style={{ fontSize: 10 }}>Influence</p>
                  <div className="mt-1.5 flex -space-x-1.5">
                    {influencers.map((p, i) => (
                      <span
                        key={i}
                        title={p.name}
                        aria-label={p.name}
                        className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold"
                        style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--panel)" }}
                      >
                        {initialsOf(p.name)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function guessProjectFor(f: Finding, projects: Project[]): Project | null {
  const titles = Object.values(f.details?.per_source ?? {}).flatMap((arr) =>
    arr.map((ev) => (ev.artifact_title ?? "").toLowerCase()),
  );
  for (const p of projects) {
    if (titles.some((t) => t.includes(p.slug.toLowerCase()))) return p;
  }
  return null;
}

/* =====================================================
   5. Sources of Truth — quiet, secondary
   ===================================================== */

function SourcesStrip({ connections }: { connections: ConnectionRow[] }) {
  if (connections.length === 0) {
    return (
      <Empty
        title="No supporting systems connected yet."
        body={<>Connect a source from <Link href="/connections" style={{ color: "var(--accent)" }} className="font-medium">Connections →</Link></>}
      />
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {connections.map((c) => (
        <Link
          key={c.id}
          href="/connections"
          className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel-2)",
            color: "var(--muted)",
          }}
        >
          {SOURCE_LABEL[c.source] ?? c.source}
          {c.account_label ? <span style={{ color: "var(--muted-2)" }}> · {c.account_label}</span> : null}
        </Link>
      ))}
    </div>
  );
}

/* =====================================================
   Empty primitive
   ===================================================== */

function Empty({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius)] border border-dashed px-6 py-10"
      style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}
    >
      <p className="text-[14.5px] font-medium">{title}</p>
      <div className="mt-2 text-[13px] leading-relaxed max-w-[58ch]" style={{ color: "var(--muted)" }}>{body}</div>
    </div>
  );
}
