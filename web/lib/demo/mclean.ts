/**
 * McLean Hospital demo dataset.
 *
 * A self-contained, hospital-shaped fixture that renders through the real app
 * (briefing, organization, explore, investigations) so a prospective customer
 * sees Husn as *their* world: inpatient psychiatry service lines, the
 * clinicians moving patients through them, and the coordination issues that
 * cost time on the floor — discharge-date conflicts, bed-status drift,
 * ownership gaps, blocked admissions, an un-propagated research amendment.
 *
 * WHY here (not the DB): it is fully reversible and self-contained. When
 * DEMO_ENABLED is false the app behaves exactly as before — `demoJson()`
 * returns undefined and `serverJson` falls through to the live API.
 *
 * TO DISABLE: set env NEXT_PUBLIC_DEMO_TENANT to anything other than "mclean"
 * (e.g. "off") at build time, or flip DEMO_ENABLED below to false.
 *
 * The shapes below intentionally mirror the API responses each page expects
 * (see web/app/{page,explore/page,organization/page,investigations/[id]/page}).
 */

export const DEMO_ENABLED = (process.env.NEXT_PUBLIC_DEMO_TENANT ?? "mclean") === "mclean";

/** ISO timestamp `mins` minutes before now (built fresh per request so the
 *  briefing's "opened 3 hours ago" / momentum stay live). */
function ago(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

/* ---------------------------------------------------------------- units */
/* "projects" in the data model == inpatient service lines / units.
 * Slugs are single tokens so the existing title-substring matcher that
 * associates findings to a unit lights up the concern counts. */
const PROJECTS = [
  { id: 1, slug: "depression", name: "Depression & Anxiety Disorders", artifact_count: 412,
    scopes: [{ source: "epic", kind: "unit", id: "DAU" }, { source: "microsoft", kind: "mailbox", id: "dau" }] },
  { id: 2, slug: "psychotic", name: "Psychotic Disorders (Schizophrenia & Bipolar)", artifact_count: 388,
    scopes: [{ source: "epic", kind: "unit", id: "AB2" }, { source: "teams", kind: "channel", id: "ab2" }] },
  { id: 3, slug: "addiction", name: "Alcohol, Drugs & Addiction — Detox → Residential → PHP", artifact_count: 531,
    scopes: [{ source: "epic", kind: "unit", id: "PROC" }, { source: "microsoft", kind: "mailbox", id: "addiction" }] },
  { id: 4, slug: "ocd", name: "OCD Institute", artifact_count: 263,
    scopes: [{ source: "epic", kind: "unit", id: "OCDI" }, { source: "teams", kind: "channel", id: "ocdi-research" }] },
  { id: 5, slug: "adolescent", name: "Simches Child & Adolescent", artifact_count: 274,
    scopes: [{ source: "epic", kind: "unit", id: "SIM" }, { source: "zoom", kind: "meetings", id: "sim" }] },
  { id: 6, slug: "geriatric", name: "Geriatric Psychiatry", artifact_count: 196,
    scopes: [{ source: "epic", kind: "unit", id: "GERI" }, { source: "microsoft", kind: "mailbox", id: "geri" }] },
  { id: 7, slug: "neurotherapeutics", name: "Psychiatric Neurotherapeutics — ECT · TMS · Ketamine", artifact_count: 307,
    scopes: [{ source: "epic", kind: "unit", id: "NEURO" }, { source: "teams", kind: "channel", id: "neuro" }] },
];

/* ------------------------------------------------------------ clinicians */
/* "persons" == clinicians and care-team staff. Division chiefs are the real
 * McLean service-line leaders; nursing/social-work/CRC/pharmacy/bed-control
 * round out the care teams. */
function person(
  id: number,
  name: string,
  email: string,
  sources: string[],
) {
  return {
    id,
    primary_name: name,
    primary_email: email,
    identities: sources.map((source) => ({ source, display_name: name, email })),
  };
}

const PERSONS = [
  person(1, "Kerry Ressler, MD, PhD", "kerry.ressler@mclean.harvard.edu", ["epic", "microsoft", "teams"]),
  person(2, "Dost Öngür, MD, PhD", "dost.ongur@mclean.harvard.edu", ["epic", "teams"]),
  person(3, "Roger Weiss, MD", "roger.weiss@mclean.harvard.edu", ["epic", "microsoft"]),
  person(4, "Daniel Dickstein, MD", "daniel.dickstein@mclean.harvard.edu", ["epic", "zoom"]),
  person(5, "Ipsit Vahia, MD", "ipsit.vahia@mclean.harvard.edu", ["epic", "microsoft", "teams"]),
  person(6, "Stephen Seiner, MD", "stephen.seiner@mclean.harvard.edu", ["epic", "teams"]),
  person(7, "Maria Alvarez, RN — Charge Nurse", "maria.alvarez@mclean.harvard.edu", ["epic", "teams"]),
  person(8, "James Okafor, LICSW — Care Coordination", "james.okafor@mclean.harvard.edu", ["epic", "microsoft"]),
  person(9, "Priya Nair — Clinical Research Coordinator", "priya.nair@mclean.harvard.edu", ["teams", "microsoft"]),
  person(10, "Aisha Rahman, MD — Resident (PGY-3)", "aisha.rahman@mclean.harvard.edu", ["epic", "teams"]),
  person(11, "David Cohen, PharmD — Inpatient Pharmacy", "david.cohen@mclean.harvard.edu", ["epic"]),
  person(12, "Tom Bradley — Patient Flow / Bed Control", "tom.bradley@mclean.harvard.edu", ["epic", "microsoft"]),
  person(13, "Sarah Lin, MD — Addiction Attending", "sarah.lin@mclean.harvard.edu", ["epic", "microsoft"]),
  person(14, "Michael Torres, MD — Geriatric Attending", "michael.torres@mclean.harvard.edu", ["epic", "teams"]),
];

/* ------------------------------------------- clinician × unit involvement */
function edge(person_id: number, project_id: number, total: number, dominant_role: string) {
  return { person_id, project_id, total, dominant_role };
}
const EDGES = [
  edge(1, 1, 41, "author"), edge(10, 1, 22, "author"), edge(7, 1, 18, "mention"), edge(12, 1, 9, "watcher"),
  edge(2, 2, 37, "author"), edge(7, 2, 20, "mention"), edge(10, 2, 15, "assignee"), edge(11, 2, 6, "watcher"),
  edge(3, 3, 44, "author"), edge(13, 3, 33, "author"), edge(8, 3, 24, "assignee"), edge(11, 3, 12, "watcher"),
  edge(9, 4, 29, "author"), edge(1, 4, 8, "mention"),
  edge(4, 5, 31, "author"), edge(10, 5, 12, "assignee"),
  edge(14, 6, 34, "author"), edge(8, 6, 19, "assignee"), edge(5, 6, 14, "mention"),
  edge(6, 7, 39, "author"), edge(11, 7, 16, "watcher"), edge(5, 7, 10, "mention"),
];

/* ----------------------------------------------------------- coordination */
/* Evidence rows mirror PerSourceEvidence. `extractor_id` carries the source
 * prefix (`epic.date`) so the investigation page groups evidence by system. */
type Ev = {
  claim_id: number; artifact_id: number; artifact_kind: string; artifact_title: string;
  value_norm: string; value: string; confidence: number; extractor_id: string;
  source_anchor: { kind: "field" | "span"; field_path?: string; snippet?: string; artifact_id?: number };
};
function ev(
  src: string, kind: string, claim_id: number, artifact_id: number,
  artifact_kind: string, artifact_title: string, value: string, confidence: number, snippet: string,
): Ev {
  return {
    claim_id, artifact_id, artifact_kind, artifact_title,
    value_norm: value, value, confidence, extractor_id: `${src}.${kind}`,
    source_anchor: { kind: "span", snippet, artifact_id },
  };
}

type Finding = {
  id: number; rule_id: string; status: "open" | "closed" | "snoozed";
  severity: "low" | "medium" | "high"; summary: string;
  details: { kind: string; key: string; distinct_values: string[]; per_source: Record<string, Ev[]> } | null;
  opened_at: string; closed_at: string | null;
};

function buildFindings(): Finding[] {
  return [
    {
      id: 101, rule_id: "R-DATE-1", status: "open", severity: "high",
      summary: "Discharge date conflict on the Addiction service: Epic order says Fri Jul 3, the care-team handoff says Sun Jul 5.",
      details: {
        kind: "date", key: "date/discharge", distinct_values: ["Fri Jul 3", "Sun Jul 5"],
        per_source: {
          epic: [ev("epic", "date", 5101, 9101, "order", "addiction — Epic discharge order", "2026-07-03", 1.0, "Planned discharge: 07/03, pending SW placement")],
          outlook: [ev("outlook", "date", 5102, 9102, "email", "addiction — care-team handoff (Outlook)", "2026-07-05", 0.7, "we're targeting Sunday the 5th once the SNF bed clears")],
        },
      },
      opened_at: ago(180), closed_at: null,
    },
    {
      id: 102, rule_id: "R-STATUS-1", status: "open", severity: "high",
      summary: "Bed-status drift on Psychotic Disorders: Epic bed board reads at-risk, the unit huddle says on-track.",
      details: {
        kind: "status", key: "status/bed_readiness", distinct_values: ["at-risk", "on-track"],
        per_source: {
          epic: [ev("epic", "status", 5103, 9103, "note", "psychotic — Epic bed board", "at-risk", 1.0, "Bed 4 flagged at-risk after overnight events")],
          teams: [ev("teams", "status", 5104, 9104, "message", "psychotic unit morning huddle (Teams)", "on-track", 0.6, "we're on-track to admit the ED hold at 2pm")],
        },
      },
      opened_at: ago(90), closed_at: null,
    },
    {
      id: 103, rule_id: "R-OWNER-1", status: "open", severity: "medium",
      summary: "Discharge ownership unclear on Geriatric Psychiatry: social work, the attending, and bed control each assume another owns placement.",
      details: {
        kind: "owner", key: "owner/discharge", distinct_values: ["James Okafor, LICSW", "Michael Torres, MD", "Bed Control"],
        per_source: {
          epic: [ev("epic", "owner", 5105, 9105, "note", "geriatric — discharge planning note", "James Okafor, LICSW", 1.0, "SW to own SNF placement")],
          outlook: [ev("outlook", "owner", 5106, 9106, "email", "geriatric — discharge thread (Outlook)", "Michael Torres, MD", 0.7, "I thought Dr. Torres was driving this one?")],
        },
      },
      opened_at: ago(20 * 60), closed_at: null,
    },
    {
      id: 104, rule_id: "R-DEP-1", status: "open", severity: "high",
      summary: "Admission to Depression & Anxiety is blocked: an ED hold is waiting on a bed forecast occupied through Thursday.",
      details: {
        kind: "dependency", key: "dependency/bed_availability", distinct_values: ["admission pending", "bed occupied"],
        per_source: {
          epic: [ev("epic", "dependency", 5107, 9107, "order", "depression — admission request", "admission pending", 1.0, "ED hold awaiting DAU bed")],
          servicenow: [ev("servicenow", "dependency", 5108, 9108, "ticket", "depression — facilities ticket (ServiceNow)", "bed occupied", 0.8, "Bed 12 forecast occupied through Thu — deep clean pending")],
        },
      },
      opened_at: ago(45), closed_at: null,
    },
    {
      id: 105, rule_id: "AGENT-FINDING-3", status: "open", severity: "medium",
      summary: "OCD Institute trial: amendment IRB-approved Monday, but the site visit calendar and coordinator playbook still show the old schedule.",
      details: {
        kind: "pattern", key: "pattern/amendment", distinct_values: ["IRB approved", "calendar unchanged"],
        per_source: {
          teams: [ev("teams", "pattern", 5109, 9109, "message", "ocd — research working group (Teams)", "IRB approved", 0.7, "amendment approved by IRB Mon — please operationalize")],
          outlook: [ev("outlook", "pattern", 5110, 9110, "email", "ocd — CRC visit tracker (Outlook)", "calendar unchanged", 0.6, "visit calendar still reflects the pre-amendment windows")],
        },
      },
      opened_at: ago(30 * 60), closed_at: null,
    },
    {
      id: 106, rule_id: "R-STATUS-1", status: "open", severity: "medium",
      summary: "Consult acknowledgement drift on Depression & Anxiety: cardiology recommendation placed in Epic, not yet acknowledged by nursing.",
      details: {
        kind: "status", key: "status/consult_ack", distinct_values: ["placed", "not acknowledged"],
        per_source: {
          epic: [ev("epic", "status", 5111, 9111, "order", "depression — cardiology consult order", "placed", 1.0, "Cardiology rec placed 06:40")],
          teams: [ev("teams", "status", 5112, 9112, "message", "depression — nursing channel (Teams)", "not acknowledged", 0.6, "nursing hasn't seen the consult rec on Bed 8")],
        },
      },
      opened_at: ago(5 * 60), closed_at: null,
    },
    {
      id: 107, rule_id: "R-OWNER-1", status: "open", severity: "medium",
      summary: "Ketamine/esketamine consent ownership unclear in Neurotherapeutics: attending, nursing, and pharmacy each reference a different owner.",
      details: {
        kind: "owner", key: "owner/consent", distinct_values: ["Stephen Seiner, MD", "Nursing", "Pharmacy"],
        per_source: {
          epic: [ev("epic", "owner", 5113, 9113, "note", "neurotherapeutics — Spravato consent note", "Stephen Seiner, MD", 1.0, "MD to confirm consent before dosing")],
          outlook: [ev("outlook", "owner", 5114, 9114, "email", "neurotherapeutics — pharmacy thread (Outlook)", "Pharmacy", 0.7, "pharmacy assumed nursing captured consent")],
        },
      },
      opened_at: ago(26 * 60), closed_at: null,
    },
    {
      id: 108, rule_id: "R-DATE-1", status: "open", severity: "medium",
      summary: "TMS course start date conflict in Neurotherapeutics: Epic scheduling shows Jul 2, the referring note says Jul 8.",
      details: {
        kind: "date", key: "date/tms_start", distinct_values: ["Jul 2", "Jul 8"],
        per_source: {
          epic: [ev("epic", "date", 5115, 9115, "appt", "neurotherapeutics — TMS schedule (Epic)", "2026-07-02", 1.0, "TMS mapping session booked 07/02")],
          outlook: [ev("outlook", "date", 5116, 9116, "email", "neurotherapeutics — referral note (Outlook)", "2026-07-08", 0.7, "patient can't start until the 8th")],
        },
      },
      opened_at: ago(40 * 60), closed_at: null,
    },
    {
      id: 109, rule_id: "AGENT-FINDING-5", status: "open", severity: "low",
      summary: "Simches Child & Adolescent: the same overnight change was re-discussed in three separate handoffs without a captured decision.",
      details: {
        kind: "pattern", key: "pattern/handoff", distinct_values: ["discussed 3×", "no captured decision"],
        per_source: {
          teams: [ev("teams", "pattern", 5117, 9117, "message", "adolescent — night handoff (Teams)", "discussed 3×", 0.6, "same watch-item raised again at sign-out")],
          zoom: [ev("zoom", "pattern", 5118, 9118, "meeting", "adolescent — family meeting (Zoom)", "no captured decision", 0.5, "plan discussed but never written into the shared sign-out")],
        },
      },
      opened_at: ago(50 * 60), closed_at: null,
    },
    {
      id: 110, rule_id: "R-STATUS-1", status: "open", severity: "high",
      summary: "Addiction service: today's discharge target assumes staffing the floor does not have — short two experienced RNs.",
      details: {
        kind: "status", key: "status/staffing", distinct_values: ["short 2 RNs", "full discharge plan"],
        per_source: {
          teams: [ev("teams", "status", 5119, 9119, "message", "addiction — staffing huddle (Teams)", "short 2 RNs", 0.7, "two experienced RNs out, one float covering")],
          epic: [ev("epic", "status", 5120, 9120, "note", "addiction — discharge plan (Epic)", "full discharge plan", 1.0, "4 discharges targeted before noon")],
        },
      },
      opened_at: ago(75), closed_at: null,
    },
    /* closed — auto-reconverged, shown under Explore → all */
    {
      id: 90, rule_id: "R-DATE-1", status: "closed", severity: "medium",
      summary: "psychotic — medication reconciliation date aligned across Epic and pharmacy.",
      details: { kind: "date", key: "date/med_rec", distinct_values: ["Jun 28"], per_source: {
        epic: [ev("epic", "date", 5090, 9090, "order", "psychotic — med rec (Epic)", "2026-06-28", 1.0, "med rec completed")],
      } },
      opened_at: ago(6 * 24 * 60), closed_at: ago(3 * 24 * 60),
    },
    {
      id: 91, rule_id: "R-STATUS-1", status: "closed", severity: "low",
      summary: "geriatric — telemetry status aligned after cardiology update.",
      details: { kind: "status", key: "status/telemetry", distinct_values: ["cleared"], per_source: {
        epic: [ev("epic", "status", 5091, 9091, "note", "geriatric — telemetry note (Epic)", "cleared", 1.0, "telemetry discontinued per cardiology")],
      } },
      opened_at: ago(8 * 24 * 60), closed_at: ago(2 * 24 * 60),
    },
  ];
}

/* TPM/charge-side "dealt with" folder → /api/findings/resolved */
function buildResolved() {
  return [
    { id: 80, rule_id: "R-DATE-1", severity: "high" as const, summary: "depression — discharge date conflict",
      details: { kind: "date", key: "date/discharge", distinct_values: ["Jun 30", "Jul 1"] },
      opened_at: ago(4 * 24 * 60), resolved_at: ago(2 * 24 * 60), resolved_by: "Kerry Ressler, MD, PhD" },
    { id: 81, rule_id: "R-OWNER-1", severity: "medium" as const, summary: "addiction — detox handoff owner unclear",
      details: { kind: "owner", key: "owner/detox", distinct_values: ["Sarah Lin, MD", "James Okafor, LICSW"] },
      opened_at: ago(5 * 24 * 60), resolved_at: ago(30 * 60), resolved_by: "James Okafor, LICSW" },
    { id: 82, rule_id: "R-STATUS-1", severity: "medium" as const, summary: "ocd — program status drift",
      details: { kind: "status", key: "status/program", distinct_values: ["at-risk", "on-track"] },
      opened_at: ago(6 * 24 * 60), resolved_at: ago(22 * 60), resolved_by: "Priya Nair" },
  ];
}

/* Investigation detail: flatten per_source into the evidence[] the case-folder
 * page expects, plus a claim_group. Resolves both live findings and the
 * "dealt with" resolved items so no demo link 404s. */
function findingDetail(id: number) {
  const f = buildFindings().find((x) => x.id === id);
  if (f) {
    const evidence = Object.values(f.details?.per_source ?? {}).flat().map((e) => ({
      role: "primary",
      claim_id: e.claim_id,
      kind: f.details?.kind ?? "",
      key: f.details?.key ?? "",
      value_norm: e.value_norm,
      value: e.value,
      confidence: e.confidence,
      extractor_id: e.extractor_id,
      source_anchor: { kind: e.source_anchor.kind, artifact_id: e.artifact_id, snippet: e.source_anchor.snippet },
    }));
    return {
      ...f,
      claim_group: { id: 700 + (id % 100), kind: f.details?.kind ?? "", key: f.details?.key ?? "", project_id: null },
      evidence,
    };
  }
  // Resolved ("dealt with") items carry a lighter shape; synthesize evidence
  // from their distinct values so the case folder still renders.
  const r = buildResolved().find((x) => x.id === id);
  if (!r) return null;
  const srcs = ["epic", "outlook", "teams"];
  const evidence = (r.details.distinct_values ?? []).map((val, i) => ({
    role: "primary",
    claim_id: 5800 + id * 10 + i,
    kind: r.details.kind,
    key: r.details.key,
    value_norm: val,
    value: val,
    confidence: i === 0 ? 1.0 : 0.7,
    extractor_id: `${srcs[i % srcs.length]}.${r.details.kind}`,
    source_anchor: { kind: "span" as const, artifact_id: 9800 + id * 10 + i, snippet: val },
  }));
  return {
    id: r.id, rule_id: r.rule_id, status: "snoozed" as const, severity: r.severity,
    summary: r.summary,
    details: { kind: r.details.kind, key: r.details.key, distinct_values: r.details.distinct_values, per_source: {} },
    opened_at: r.opened_at, closed_at: null,
    claim_group: { id: 700 + (id % 100), kind: r.details.kind, key: r.details.key, project_id: null },
    evidence,
  };
}

function findingsSummary(all: Finding[]) {
  const open = all.filter((f) => f.status === "open");
  const closed = all.filter((f) => f.status === "closed");
  const open_by_rule: Record<string, number> = {};
  for (const f of open) open_by_rule[f.rule_id] = (open_by_rule[f.rule_id] ?? 0) + 1;
  return {
    open: open.length,
    closed: closed.length,
    open_by_rule,
    last_open_at: open.length ? open.map((f) => f.opened_at).sort().at(-1) : null,
  };
}

const CONNECTIONS = [
  { id: 1, source: "epic", account_label: "MGB Epic (Partners eCare) — SMART-on-FHIR R4, Org 404", artifact_count: 1840 },
  { id: 2, source: "microsoft", account_label: "Microsoft 365 — Outlook & Teams", artifact_count: 372 },
  { id: 3, source: "zoom", account_label: "Zoom Health — telepsychiatry", artifact_count: 96 },
  { id: 4, source: "servicenow", account_label: "ServiceNow — facilities & IT", artifact_count: 63 },
];

/**
 * Resolve a demo payload for a server-side API path. Returns `undefined` for
 * any path the demo does not own (auth, mutations, etc.) so the caller falls
 * through to the live API.
 */
export function demoJson(path: string): unknown | undefined {
  if (!DEMO_ENABLED) return undefined;
  const [p, q = ""] = path.split("?");
  const qs = new URLSearchParams(q);
  const all = buildFindings();

  if (p === "/api/graph/projects") return { projects: PROJECTS };
  if (p === "/api/graph/persons") return { persons: PERSONS };
  if (p === "/api/graph/people-projects") return { items: EDGES };
  if (p === "/api/graph/summary") {
    return {
      counts: {
        persons: PERSONS.length, projects: PROJECTS.length, artifacts: 2371,
        person_identities: 31, project_sources: 14, artifact_mentions: 5200,
        raw_pending_normalization: 0,
      },
      last_raw_fetched_at: ago(6),
      last_normalized_at: ago(8),
    };
  }
  if (p === "/api/agent/status") {
    return {
      provider: "groq", model: "llama-3.3-70b-versatile",
      last_run_at: ago(12), last_ok_at: ago(12),
      total_runs: 84, total_briefs: 210, in_progress: 0,
    };
  }
  if (p === "/api/connections") return { items: CONNECTIONS };
  if (p === "/api/findings/summary") return findingsSummary(all);
  if (p === "/api/findings/resolved") return { items: buildResolved() };
  if (p === "/api/findings") {
    const status = qs.get("status") ?? "open";
    const items = status === "all" ? all : all.filter((f) => f.status === "open");
    return { items };
  }
  if (p.startsWith("/api/findings/")) {
    const id = Number(p.split("/").pop());
    if (Number.isFinite(id)) return findingDetail(id);
  }
  return undefined;
}

/**
 * Short-circuit the demo-owned mutations (mark "dealt with" / recall) so the
 * buttons on demo findings succeed instead of 404-ing against the live API for
 * IDs that don't exist in the real tenant. Returns undefined for everything
 * else so real mutations (auth, connections, chat, sync) pass through.
 */
export function demoMutation(path: string, method: string): Response | undefined {
  if (!DEMO_ENABLED || method.toUpperCase() !== "POST") return undefined;
  const p = path.split("?")[0];
  if (/^\/api\/findings\/\d+\/(dealt-with|reopen)$/.test(p)) {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return undefined;
}
