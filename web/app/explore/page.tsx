import Link from "next/link";

import { RecallButton } from "@/components/recall-button";
import { serverJson } from "@/lib/api";

/* ============================================================
   Explore — organized by understanding, not by issue type.
   The lenses are: Projects · Teams · Risks · Ownership ·
   Dependencies · Decisions · Resolved. Each lens is a way of
   reading the same underlying activity, not a separate inbox.
   ============================================================ */

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

/* A TPM-resolved ("dealt with") issue, from /api/findings/resolved. Distinct
   from a `closed` Finding: it's snoozed, kept, and recallable. */
type ResolvedFinding = {
  id: number;
  rule_id: string;
  severity: "low" | "medium" | "high";
  summary: string;
  details: { kind?: string; key?: string; distinct_values?: string[] } | null;
  opened_at: string;
  resolved_at: string;
  resolved_by: string | null;
};

type Project = { id: number; slug: string; name: string; artifact_count: number; scopes: { source: string }[] };
type Person = { id: number; primary_name: string | null; primary_email: string | null; identities: { source: string }[] };

const SOURCE_LABEL: Record<string, string> = { epic: "Epic", pacs: "PACS", orboard: "OR Board", pager: "Secure Chat", labs: "Labs", sched: "Scheduling", slack: "Slack", email: "Email" };

type Lens = "areas" | "team" | "emergencies" | "high" | "pending" | "requests" | "resolved";

const LENSES: { key: Lens; label: string; tagline: string }[] = [
  { key: "areas", label: "Areas", tagline: "Where you're working — OR, ICU, ward, ED, tumour board, clinic." },
  { key: "team", label: "Care team", tagline: "Who you're coordinating with on the floor today." },
  { key: "emergencies", label: "Emergencies", tagline: "Act now — patient safety or the OR can't wait." },
  { key: "high", label: "High priority", tagline: "Blocking your next case or decision." },
  { key: "pending", label: "Pending", tagline: "What you owe before the day gets away from you." },
  { key: "requests", label: "Requests", tagline: "Inbound — consults, pages, scheduling, family." },
  { key: "resolved", label: "Resolved", tagline: "Handled — kept here, not deleted, and recallable." },
];

const SEV_RANK = { high: 3, medium: 2, low: 1 } as const;
function byConsequence(a: Finding, b: Finding) {
  const s = SEV_RANK[b.severity] - SEV_RANK[a.severity];
  if (s !== 0) return s;
  return Date.parse(b.opened_at) - Date.parse(a.opened_at);
}

function prettyKey(key?: string | null): string {
  if (!key) return "this";
  const last = key.split("/").pop() || key;
  return last.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function cleanTitle(f: { rule_id: string; summary: string; details?: { key?: string | null } | null }): string {
  const key = prettyKey(f.details?.key);
  if (f.rule_id === "R-DATE-1") return `${key} conflict`;
  if (f.rule_id === "R-STATUS-1") return `${key} drift`;
  if (f.rule_id === "R-OWNER-1") return `${key} unclear`;
  if (f.rule_id.startsWith("R-DEP-")) return `${key} dependency`;
  if (f.rule_id.startsWith("AGENT-FINDING-")) return f.summary.split(":")[0].split(" (")[0].trim() || "Pattern flagged";
  return f.summary.split(":")[0].split(" (")[0].trim() || "Concern";
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

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ lens?: Lens }> }) {
  const sp = await searchParams;
  const lens: Lens = LENSES.some((l) => l.key === sp.lens) ? (sp.lens as Lens) : "areas";

  const [findingsRes, projectsRes, personsRes, resolvedRes] = await Promise.all([
    serverJson<{ items: Finding[] }>("/api/findings?status=all&limit=200"),
    serverJson<{ projects: Project[] }>("/api/graph/projects"),
    serverJson<{ persons: Person[] }>("/api/graph/persons?limit=200"),
    serverJson<{ items: ResolvedFinding[] }>("/api/findings/resolved?limit=200"),
  ]);

  const allFindings = (findingsRes?.items ?? []);
  const open = allFindings.filter((f) => f.status === "open");
  const resolved = resolvedRes?.items ?? [];

  return (
    <main className="mx-auto px-6 lg:px-12 pt-12 pb-32" style={{ maxWidth: 1100 }}>
      <header className="husn-rise" style={{ maxWidth: 720 }}>
        <p className="husn-eyebrow">Explore</p>
        <h1 className="husn-display mt-4">{LENSES.find((l) => l.key === lens)?.label}</h1>
        <p className="husn-prose mt-5 max-w-[60ch]">{LENSES.find((l) => l.key === lens)?.tagline}</p>
      </header>

      {/* Lens nav — a clean horizontal rail, no tabs-y feel */}
      <nav className="mt-10 -mx-1 flex flex-wrap items-center gap-1" aria-label="Lenses">
        {LENSES.map((l) => (
          <Link
            key={l.key}
            href={l.key === "areas" ? "/explore" : `/explore?lens=${l.key}`}
            className="rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors"
            style={{
              borderColor: l.key === lens ? "var(--text)" : "var(--border)",
              background: l.key === lens ? "var(--text)" : "var(--panel)",
              color: l.key === lens ? "var(--bg)" : "var(--text-2)",
            }}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <section className="mt-10 husn-rise" style={{ animationDelay: "60ms" }}>
        {lens === "areas" ? <ProjectsLens projects={projectsRes?.projects ?? []} findings={open} /> : null}
        {lens === "team" ? <TeamsLens persons={personsRes?.persons ?? []} /> : null}
        {lens === "emergencies" ? <FindingsLens items={open.filter((f) => f.rule_id === "EMERGENCY").sort(byConsequence)} hint="Act now — patient safety or the OR can't wait." /> : null}
        {lens === "high" ? <FindingsLens items={open.filter((f) => f.rule_id === "HIGH").sort(byConsequence)} hint="Blocking your next case or decision." /> : null}
        {lens === "pending" ? <FindingsLens items={open.filter((f) => f.rule_id === "PENDING").sort(byConsequence)} hint="What you owe before the day gets away from you." /> : null}
        {lens === "requests" ? <FindingsLens items={open.filter((f) => f.rule_id === "REQUEST").sort(byConsequence)} hint="Inbound — consults, pages, scheduling, and family, waiting on you." /> : null}
        {lens === "resolved" ? <ResolvedLens items={resolved} /> : null}
      </section>
    </main>
  );
}

/* ------- Project lens ------- */
function ProjectsLens({ projects, findings }: { projects: Project[]; findings: Finding[] }) {
  if (projects.length === 0) return <EmptyEditorial title="No areas mapped yet." body={<>Connect a tool to give Husn somewhere to read from. <Link href="/connections" style={{ color: "var(--accent)" }} className="font-medium">Open Connections →</Link></>} />;
  return (
    <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {projects.map((p) => {
        // Word-boundary match so an area slug never matches inside another word.
        const slugRe = new RegExp(`\\b${p.slug.toLowerCase()}\\b`);
        const related = findings.filter((f) =>
          Object.values(f.details?.per_source ?? {}).some((arr: unknown) =>
            Array.isArray(arr) && (arr as { artifact_title?: string }[]).some((ev) => slugRe.test((ev.artifact_title ?? "").toLowerCase())),
          ),
        );
        const state = related.length === 0 ? "Quiet" : `${related.length} open ${related.length === 1 ? "concern" : "concerns"}`;
        const tone = related.length === 0 ? "aligned" : related.length <= 2 ? "uncertain" : "conflict";
        return (
          <li key={p.id}>
            <Link
              href="/organization"
              className="block rounded-[var(--radius)] border px-5 py-5 husn-lift"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10.5px] font-mono uppercase" style={{ color: "var(--muted-2)", letterSpacing: 0.06 }}>{p.slug}</p>
                  <h3 className="husn-heading mt-1.5" style={{ fontSize: 18 }}>{p.name}</h3>
                  <p className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>{state}.</p>
                </div>
                <ToneDot tone={tone} />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {p.scopes.slice(0, 4).map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px]" style={{ borderColor: "var(--border)", background: "var(--panel-2)", color: "var(--muted)" }}>
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

/* ------- Teams lens ------- */
function TeamsLens({ persons }: { persons: Person[] }) {
  if (persons.length === 0) return <EmptyEditorial title="No care team resolved yet." body="They appear here as Husn reads activity across your tools." />;
  return (
    <>
      <p className="husn-prose mb-6 max-w-[58ch]">
        Husn resolves the same person across Epic, the OR board, and secure chat.
        Below are the people on the floor you&apos;re coordinating with today.
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {persons.slice(0, 24).map((p) => {
          const name = p.primary_name ?? p.primary_email ?? `#${p.id}`;
          const initials = (name.match(/\b[\p{L}\p{N}]/gu) || []).slice(0, 2).join("").toUpperCase() || "·";
          return (
            <li key={p.id} className="rounded-[var(--radius)] border p-4 husn-lift" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
              <div className="flex items-start gap-3">
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold shrink-0" style={{ background: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--border)" }}>
                  {initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{name}</p>
                  {p.primary_email ? <p className="truncate text-[12px]" style={{ color: "var(--muted)" }}>{p.primary_email}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.identities.slice(0, 4).map((idt, i) => (
                      <span key={i} className="rounded-md border px-1.5 py-0.5 font-mono text-[9.5px]" style={{ borderColor: "var(--border)", color: "var(--muted)", background: "var(--panel-2)" }}>
                        {SOURCE_LABEL[idt.source] ?? idt.source}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------- Findings lens (Risks, Ownership, Dependencies) ------- */
function FindingsLens({ items, hint }: { items: Finding[]; hint: string }) {
  if (items.length === 0) {
    return <EmptyEditorial title="Nothing to see here." body={hint} />;
  }
  return (
    <>
      <p className="husn-prose mb-6 max-w-[58ch]">{hint}</p>
      <ul className="space-y-2">
        {items.map((f) => {
          const tone = f.severity === "high" ? "conflict" : f.severity === "medium" ? "uncertain" : "understood";
          return (
            <li key={f.id}>
              <Link
                href={`/investigations/${f.id}`}
                className="block rounded-[var(--radius)] border px-5 py-5 husn-lift"
                style={{ borderColor: "var(--border)", background: "var(--panel)" }}
              >
                <div className="flex items-start gap-3">
                  <ToneDot tone={tone} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15.5px] font-medium" style={{ color: "var(--text)" }}>{cleanTitle(f)}</p>
                    <p className="mt-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
                      Opened {timeAgo(f.opened_at)}
                    </p>
                  </div>
                  <span aria-hidden className="self-center text-[14px]" style={{ color: "var(--muted)" }}>→</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------- Resolved lens — the TPM "dealt with" folder, with recall ------- */
function ResolvedLens({ items }: { items: ResolvedFinding[] }) {
  if (items.length === 0) {
    return (
      <EmptyEditorial
        title="Nothing has been resolved yet."
        body={
          <>
            When you mark an issue &ldquo;dealt with,&rdquo; it moves here instead of being
            deleted — and can be recalled if it needs attention again.
          </>
        }
      />
    );
  }
  return (
    <>
      <p className="husn-prose mb-6 max-w-[58ch]">
        Issues you marked as dealt with. They no longer count against your confidence or
        appear in the briefing — but they&rsquo;re kept here, not deleted. Recall one to bring
        it back as an open issue.
      </p>
      <ul className="space-y-2">
        {items.map((f) => {
          const tone = f.severity === "high" ? "conflict" : f.severity === "medium" ? "uncertain" : "understood";
          return (
            <li key={f.id}>
              <div
                className="flex items-start gap-3 rounded-[var(--radius)] border px-5 py-5"
                style={{ borderColor: "var(--border)", background: "var(--panel)" }}
              >
                <ToneDot tone={tone} />
                <Link href={`/investigations/${f.id}`} className="min-w-0 flex-1">
                  <p className="text-[15.5px] font-medium" style={{ color: "var(--text)" }}>{cleanTitle(f)}</p>
                  <p className="mt-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
                    Resolved {timeAgo(f.resolved_at)}
                    {f.resolved_by ? ` · by ${f.resolved_by}` : ""}
                  </p>
                </Link>
                <RecallButton findingId={f.id} size="sm" />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------- Dependencies lens ------- */
function DependenciesLens({ items }: { items: Finding[] }) {
  if (items.length === 0) {
    return (
      <EmptyEditorial
        title="Nothing is stalled."
        body="Husn watches for items waiting on a single pending step — an unread analysis, an unapproved amendment, an outstanding reply. None are stuck right now."
      />
    );
  }
  return <FindingsLens items={items} hint="Each of these is waiting on one thing to move." />;
}

/* ------- Decisions lens ------- */
function DecisionsLens() {
  return (
    <EmptyEditorial
      title="Decisions surfacing is in development."
      body="Husn already tracks dates, owners, statuses, and dependencies. Surfacing decisions as a first-class lens — what was agreed, by whom, and where it's now shifting — is the next deterministic rule on the roadmap."
    />
  );
}

/* ------- shared ------- */
function ToneDot({ tone }: { tone: "aligned" | "uncertain" | "conflict" | "understood" }) {
  const colorVar =
    tone === "aligned" ? "var(--aligned)" :
    tone === "uncertain" ? "var(--uncertain)" :
    tone === "conflict" ? "var(--conflict)" :
    "var(--understood)";
  const softVar =
    tone === "aligned" ? "var(--aligned-soft)" :
    tone === "uncertain" ? "var(--uncertain-soft)" :
    tone === "conflict" ? "var(--conflict-soft)" :
    "var(--understood-soft)";
  return (
    <span
      aria-hidden
      className="mt-1.5 inline-block rounded-full shrink-0 husn-pulse"
      style={{ width: 10, height: 10, background: colorVar, boxShadow: `0 0 0 5px ${softVar}` }}
    />
  );
}

function EmptyEditorial({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed px-6 py-12" style={{ borderColor: "var(--border-strong)", background: "var(--panel-2)" }}>
      <p className="text-[15px] font-medium" style={{ color: "var(--text)" }}>{title}</p>
      <div className="mt-2 text-[13.5px] leading-relaxed max-w-[58ch]" style={{ color: "var(--muted)" }}>{body}</div>
    </div>
  );
}
