import Link from "next/link";

import { FETCH_INIT } from "@/lib/fetch-init";

/* ============================================================
   Organization — hybrid: narrative + structure.
   We do not draw a spaghetti graph. We narrate the shape of
   the org and then show one structural map: projects → sources
   → people. Designed for a TPM, not a graph theorist.
   ============================================================ */

const SERVER_API_URL = process.env.API_URL ?? "http://api:8000";

type ProjectScope = { source: string; kind: string; id: string };
type Project = { id: number; slug: string; name: string; artifact_count: number; scopes: ProjectScope[] };
type PersonIdentity = { source: string; source_user_id: string; display_name: string | null; email: string | null };
type Person = { id: number; primary_name: string | null; primary_email: string | null; identities: PersonIdentity[] };
type GraphSummary = {
  counts: {
    persons: number;
    person_identities: number;
    projects: number;
    project_sources: number;
    artifacts: number;
    artifact_mentions: number;
    raw_pending_normalization: number;
  };
  last_raw_fetched_at: string | null;
  last_normalized_at: string | null;
};

async function fetchSummary(): Promise<GraphSummary | null> {
  try { const r = await fetch(`${SERVER_API_URL}/api/graph/summary`, FETCH_INIT); return r.ok ? await r.json() : null; }
  catch { return null; }
}
async function fetchProjects(): Promise<Project[]> {
  try { const r = await fetch(`${SERVER_API_URL}/api/graph/projects`, FETCH_INIT); if (!r.ok) return []; return ((await r.json()) as { projects: Project[] }).projects; }
  catch { return []; }
}
async function fetchPersons(): Promise<Person[]> {
  try { const r = await fetch(`${SERVER_API_URL}/api/graph/persons?limit=200`, FETCH_INIT); if (!r.ok) return []; return ((await r.json()) as { persons: Person[] }).persons; }
  catch { return []; }
}

const SOURCE_LABEL: Record<string, string> = { jira: "Jira", slack: "Slack", google: "Google", microsoft: "Microsoft" };

export default async function OrganizationPage() {
  const [summary, projects, persons] = await Promise.all([fetchSummary(), fetchProjects(), fetchPersons()]);

  const totalArtifacts = summary?.counts.artifacts ?? 0;
  const totalProjects = summary?.counts.projects ?? projects.length;
  const totalPeople = summary?.counts.persons ?? persons.length;

  return (
    <main className="mx-auto px-6 lg:px-10 pt-12 pb-24" style={{ maxWidth: "var(--content-w)" }}>
      <header className="husn-rise" style={{ maxWidth: 720 }}>
        <p className="husn-eyebrow">Organization</p>
        <h1 className="husn-display mt-4">{narrate(totalProjects, totalPeople, totalArtifacts)}</h1>
        <p className="husn-prose mt-5 max-w-[60ch]">
          Husn maps every claim, document, and message back to the people and projects
          they belong to. This is the structural view — start from a project to see
          its sources and owners, or from a person to see what they touch.
        </p>
      </header>

      {/* Counts strip — bare numerals, no widgets */}
      <section className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-8 husn-rise" style={{ animationDelay: "60ms" }}>
        <CountBlock label="Projects" value={totalProjects} />
        <CountBlock label="People" value={totalPeople} />
        <CountBlock label="Source artifacts" value={totalArtifacts} />
        <CountBlock label="Mentions linked" value={summary?.counts.artifact_mentions ?? 0} />
      </section>

      {/* Projects */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "120ms" }}>
        <div className="mb-6 max-w-[var(--reading-w)]">
          <p className="husn-eyebrow">By project</p>
          <h2 className="husn-title mt-3">Where the work lives</h2>
          <p className="husn-prose mt-3 max-w-[58ch]">
            Each project is anchored to the sources that own its truth — the Jira
            project, the Slack channel, the Drive folder. When those drift, the
            briefing surfaces it.
          </p>
        </div>
        {projects.length === 0 ? (
          <EmptyBlock>
            <p>No projects mapped yet. Connect a source to give Husn somewhere to read from.</p>
            <Link href="/connections" className="mt-3 inline-block text-[13.5px] font-medium" style={{ color: "var(--accent)" }}>
              Connect a tool →
            </Link>
          </EmptyBlock>
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => <ProjectRow key={p.id} project={p} />)}
          </ul>
        )}
      </section>

      {/* People */}
      <section className="mt-20 husn-rise" style={{ animationDelay: "180ms" }}>
        <div className="mb-6 max-w-[var(--reading-w)]">
          <p className="husn-eyebrow">By person</p>
          <h2 className="husn-title mt-3">Who is in the picture</h2>
          <p className="husn-prose mt-3 max-w-[58ch]">
            Husn resolves the same person across their Slack handle, Jira account,
            and email aliases. That is what lets it tell you who actually owns a
            decision — not which account showed up first.
          </p>
        </div>
        {persons.length === 0 ? (
          <EmptyBlock>
            <p>No people resolved yet. They show up here as Husn reads activity.</p>
          </EmptyBlock>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {persons.slice(0, 18).map((p) => <PersonCard key={p.id} person={p} />)}
          </ul>
        )}
      </section>
    </main>
  );
}

function narrate(projects: number, people: number, artifacts: number): string {
  if (projects === 0 && people === 0) return "Your organization, mapped.";
  if (projects === 0) return `${people} ${people === 1 ? "person" : "people"} in the picture so far.`;
  return `${projects} project${projects === 1 ? "" : "s"}, ${people} ${people === 1 ? "person" : "people"}, ${artifacts.toLocaleString()} signals.`;
}

function CountBlock({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="tabular" style={{ fontSize: 48, lineHeight: 1, letterSpacing: "-0.03em", fontWeight: 600 }}>
        {value.toLocaleString()}
      </p>
      <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>{label}</p>
    </div>
  );
}

function ProjectRow({ project }: { project: Project }) {
  return (
    <li
      className="rounded-[var(--radius)] border px-6 py-5 husn-lift"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-mono uppercase" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>
            {project.slug}
          </p>
          <h3 className="husn-heading mt-1.5">{project.name}</h3>
          <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
            {project.artifact_count.toLocaleString()} signals tracked across {project.scopes.length}{" "}
            {project.scopes.length === 1 ? "source" : "sources"}.
          </p>
          {project.scopes.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {project.scopes.map((s, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]"
                  style={{ borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--muted)" }}
                  title={`${s.kind}: ${s.id}`}
                >
                  <span>{SOURCE_LABEL[s.source] ?? s.source}</span>
                  <span aria-hidden style={{ opacity: 0.4 }}>·</span>
                  <span className="font-medium" style={{ color: "var(--text-2)" }}>{s.id}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <span aria-hidden className="text-[15px] shrink-0 self-center" style={{ color: "var(--muted)" }}>→</span>
      </div>
    </li>
  );
}

function PersonCard({ person }: { person: Person }) {
  const name = person.primary_name ?? person.primary_email ?? `#${person.id}`;
  const initials = (name.match(/\b[\p{L}\p{N}]/gu) || []).slice(0, 2).join("").toUpperCase();
  return (
    <li
      className="rounded-[var(--radius)] border p-4 husn-lift"
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold shrink-0"
          style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {initials || "·"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{name}</p>
          {person.primary_email ? (
            <p className="truncate text-[12px]" style={{ color: "var(--muted)" }}>
              {person.primary_email}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1">
            {person.identities.slice(0, 4).map((idt, i) => (
              <span
                key={i}
                className="rounded-md border px-1.5 py-0.5 font-mono text-[9.5px]"
                style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--panel-2)" }}
                title={idt.display_name ?? idt.email ?? idt.source_user_id}
              >
                {SOURCE_LABEL[idt.source] ?? idt.source}
              </span>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius)] border border-dashed px-6 py-10"
      style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}
    >
      <div className="max-w-[58ch] text-[14px]" style={{ color: "var(--muted)" }}>
        {children}
      </div>
    </div>
  );
}
