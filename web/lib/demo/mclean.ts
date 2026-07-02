/**
 * Demo dataset — the floor surgeon / attending (ICP).
 *
 * The user is a surgeon on the floor all day: running multiple OR cases, doing
 * inpatient rounds/checkups, and meeting families. Husn reconstructs — from
 * Epic + PACS + the OR board + pager + labs — the four things he asks between
 * cases: what's about to surprise me, what blocks my next case, what do I owe,
 * and who's waiting on me.
 *
 * Grounded in /Users/bawani/idea/hopital_idea/deep-research-report.md
 * (Surgeon/Attending/Resident composite workdays + the proactive-intelligence
 * cue lists) and MCLEAN_ICP_DOSSIER.md (the real MGB/McLean systems stack:
 * Epic/OpTime, Visage 7 PACS, Beaker LIS, Cadence). No PHI — generic
 * bed/case labels only.
 *
 * Findings are categorised by rule_id into the four home "vitals", in order:
 *   EMERGENCY → act-now, patient-safety or OR-critical
 *   HIGH      → blocks his NEXT case or decision
 *   PENDING   → what HE owes today
 *   REQUEST   → inbound asks waiting on him (consults, pages, scheduling, family)
 *
 * TO DISABLE: set NEXT_PUBLIC_DEMO_TENANT to anything but "mclean" at build
 * time, or flip DEMO_ENABLED below.
 */

export const DEMO_ENABLED = (process.env.NEXT_PUBLIC_DEMO_TENANT ?? "mclean") === "mclean";

function ago(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

/* --------------------------------------------------------------- floor areas */
/* "projects" == the areas the surgeon moves between. Slugs are unique tokens
 * (word-boundary matched) that prefix each evidence title. */
const PROJECTS = [
  { id: 1, slug: "theatre", name: "Operating Room", artifact_count: 143,
    scopes: [{ source: "orboard", kind: "board", id: "or" }, { source: "epic", kind: "optime", id: "or" }] },
  { id: 2, slug: "icu", name: "ICU / Critical Care", artifact_count: 96,
    scopes: [{ source: "epic", kind: "unit", id: "icu" }, { source: "pager", kind: "escalation", id: "icu" }] },
  { id: 3, slug: "ward", name: "Inpatient Ward", artifact_count: 211,
    scopes: [{ source: "epic", kind: "unit", id: "ward" }, { source: "labs", kind: "results", id: "ward" }] },
  { id: 4, slug: "ed", name: "ED Consults", artifact_count: 64,
    scopes: [{ source: "pager", kind: "consult", id: "ed" }, { source: "pacs", kind: "imaging", id: "ed" }] },
  { id: 5, slug: "mdt", name: "Tumour Board / MDT", artifact_count: 58,
    scopes: [{ source: "labs", kind: "pathology", id: "mdt" }, { source: "epic", kind: "conference", id: "mdt" }] },
  { id: 6, slug: "clinic", name: "Post-op Clinic", artifact_count: 72,
    scopes: [{ source: "sched", kind: "clinic", id: "clinic" }, { source: "epic", kind: "followup", id: "clinic" }] },
  { id: 7, slug: "family", name: "Family Meetings", artifact_count: 39,
    scopes: [{ source: "epic", kind: "note", id: "family" }, { source: "pager", kind: "message", id: "family" }] },
];

/* -------------------------------------------------------------- the care team */
function person(id: number, name: string, email: string, sources: string[]) {
  return { id, primary_name: name, primary_email: email,
    identities: sources.map((source) => ({ source, display_name: name, email })) };
}
const PERSONS = [
  person(1, "Chief Resident", "chief.resident@mgb.org", ["epic", "pager"]),
  person(2, "Junior Resident", "junior.resident@mgb.org", ["epic", "pager"]),
  person(3, "Anaesthesiologist", "anaesthesia@mgb.org", ["epic", "orboard"]),
  person(4, "OR Scrub Nurse", "or.scrub@mgb.org", ["orboard"]),
  person(5, "Charge Nurse — Ward", "charge.nurse@mgb.org", ["epic", "pager"]),
  person(6, "PACU Nurse", "pacu.nurse@mgb.org", ["orboard", "epic"]),
  person(7, "Dr. Reyes — ICU Intensivist", "reyes@mgb.org", ["epic", "pager"]),
  person(8, "Dr. Okafor — Cardiology", "okafor@mgb.org", ["epic", "pager"]),
  person(9, "Dr. Hahn — Radiology", "hahn@mgb.org", ["pacs", "epic"]),
  person(10, "Dr. Silva — Pathology", "silva@mgb.org", ["labs", "epic"]),
  person(11, "Case Manager / Social Work", "case.mgmt@mgb.org", ["epic", "pager"]),
  person(12, "OR Board Coordinator", "or.board@mgb.org", ["orboard", "sched"]),
  person(13, "Transport", "transport@mgb.org", ["pager"]),
  person(14, "Blood Bank / Transfusion", "blood.bank@mgb.org", ["epic", "labs"]),
];

function edge(person_id: number, project_id: number, total: number, dominant_role: string) {
  return { person_id, project_id, total, dominant_role };
}
const EDGES = [
  edge(1, 3, 34, "author"), edge(1, 1, 18, "assignee"),
  edge(2, 3, 27, "assignee"),
  edge(3, 1, 29, "author"), edge(4, 1, 16, "assignee"),
  edge(5, 3, 31, "author"), edge(6, 1, 14, "assignee"),
  edge(7, 2, 33, "author"), edge(13, 2, 9, "mention"),
  edge(8, 3, 21, "mention"), edge(9, 3, 19, "author"), edge(9, 1, 8, "mention"),
  edge(10, 5, 24, "author"), edge(11, 3, 22, "assignee"), edge(11, 7, 12, "assignee"),
  edge(12, 1, 20, "author"), edge(14, 1, 11, "watcher"),
];

/* -------------------------------------------------------------- coordination */
type Ev = {
  claim_id: number; artifact_id: number; artifact_kind: string; artifact_title: string;
  value_norm: string; value: string; confidence: number; extractor_id: string;
  source_anchor: { kind: "field" | "span"; field_path?: string; snippet?: string; artifact_id?: number };
};
function ev(src: string, kind: string, claim_id: number, artifact_id: number,
  artifact_kind: string, artifact_title: string, value: string, confidence: number, snippet: string): Ev {
  return { claim_id, artifact_id, artifact_kind, artifact_title, value_norm: value, value, confidence,
    extractor_id: `${src}.${kind}`, source_anchor: { kind: "span", snippet, artifact_id } };
}

type Finding = {
  id: number; rule_id: string; status: "open" | "closed" | "snoozed";
  severity: "low" | "medium" | "high"; summary: string;
  details: { kind: string; key: string; distinct_values: string[]; per_source: Record<string, Ev[]> } | null;
  opened_at: string; closed_at: string | null;
};

/* Each summary is one terse, time-stamped, sourced alert (surgeon voice).
 * artifact_title is prefixed with the area slug for workstream attribution. */
function buildFindings(): Finding[] {
  return [
    /* ---------------- EMERGENCY (act now) ---------------- */
    {
      id: 101, rule_id: "EMERGENCY", status: "open", severity: "high",
      summary: "Rapid response on Bed 7 (post-op day 1): respiratory therapy acknowledged, ICU triage has NOT — last lactate drawn 14 min ago.",
      details: { kind: "emergency", key: "emergency/rapid_response", distinct_values: ["RT acknowledged", "ICU not acknowledged"], per_source: {
        pager: [ev("pager", "emergency", 5101, 9101, "page", "icu: Bed 7 rapid response (Secure Chat)", "ICU not acknowledged", 1.0, "RT ack'd; ICU triage no response yet")],
        labs: [ev("labs", "emergency", 5102, 9102, "result", "icu: Bed 7 lactate (Labs)", "lactate 14 min ago", 0.9, "last lactate resulted 14 min ago, trending up")],
      } },
      opened_at: ago(14), closed_at: null,
    },
    {
      id: 102, rule_id: "EMERGENCY", status: "open", severity: "high",
      summary: "Critical potassium on Bed 12 posted after rounds — still not acknowledged by your service.",
      details: { kind: "emergency", key: "emergency/critical_lab", distinct_values: ["critical K+ resulted", "unacknowledged"], per_source: {
        labs: [ev("labs", "emergency", 5103, 9103, "result", "ward: Bed 12 potassium (Labs)", "critical K+ resulted", 1.0, "critical value flagged, posted 09:52 after rounds")],
        epic: [ev("epic", "emergency", 5104, 9104, "inbasket", "ward: Bed 12 in-basket (Epic)", "unacknowledged", 0.8, "no acknowledgement from ordering service")],
      } },
      opened_at: ago(38), closed_at: null,
    },
    {
      id: 103, rule_id: "EMERGENCY", status: "open", severity: "high",
      summary: "OR-2 turnover is blocked on blood availability, not room cleaning — the colon resection can't start until 2 units are released.",
      details: { kind: "emergency", key: "emergency/or_blood", distinct_values: ["room ready", "blood not released"], per_source: {
        orboard: [ev("orboard", "emergency", 5105, 9105, "board", "theatre: OR-2 turnover (OR Board)", "room ready", 1.0, "room cleaned; case flagged not-ready")],
        epic: [ev("epic", "emergency", 5106, 9106, "order", "theatre: OR-2 transfusion order (Epic)", "blood not released", 0.9, "2 units not yet released by transfusion medicine")],
      } },
      opened_at: ago(25), closed_at: null,
    },
    /* ---------------- HIGH PRIORITY (blocks the next case) ---------------- */
    {
      id: 104, rule_id: "HIGH", status: "open", severity: "high",
      summary: "First case (OR-1, lap chole) is missing the outside imaging import — the CT is in the chart but not in the PACS viewer you mark the target in.",
      details: { kind: "high", key: "high/imaging_import", distinct_values: ["CT in chart", "not in PACS viewer"], per_source: {
        epic: [ev("epic", "high", 5107, 9107, "media", "theatre: OR-1 outside CT (Epic)", "CT in chart", 1.0, "outside CT attached to the chart")],
        pacs: [ev("pacs", "high", 5108, 9108, "study", "theatre: OR-1 PACS viewer (PACS)", "not in PACS viewer", 0.9, "study hasn't imported into Visage")],
      } },
      opened_at: ago(55), closed_at: null,
    },
    {
      id: 105, rule_id: "HIGH", status: "open", severity: "high",
      summary: "Post-op ICU bed for case 3 is not guaranteed — the bed you're counting on is forecast to stay occupied.",
      details: { kind: "high", key: "high/icu_bed", distinct_values: ["case 3 needs ICU", "bed forecast occupied"], per_source: {
        orboard: [ev("orboard", "high", 5109, 9109, "board", "theatre: case 3 post-op plan (OR Board)", "case 3 needs ICU", 1.0, "case 3 requires a guaranteed ICU bed")],
        epic: [ev("epic", "high", 5110, 9110, "bed", "icu: bed forecast (Epic)", "bed forecast occupied", 0.8, "target bed forecast occupied through the afternoon")],
      } },
      opened_at: ago(70), closed_at: null,
    },
    {
      id: 106, rule_id: "HIGH", status: "open", severity: "medium",
      summary: "Consultant recommended Bed 9 for surgery, but anaesthesia hasn't assessed the patient yet.",
      details: { kind: "high", key: "high/anaesthesia", distinct_values: ["surgery recommended", "anaesthesia not assessed"], per_source: {
        epic: [ev("epic", "high", 5111, 9111, "consult", "ward: Bed 9 surgical consult (Epic)", "surgery recommended", 1.0, "consultant recommends operative management")],
        pager: [ev("pager", "high", 5112, 9112, "page", "ward: Bed 9 anaesthesia (Secure Chat)", "anaesthesia not assessed", 0.7, "no pre-op assessment logged")],
      } },
      opened_at: ago(5 * 60), closed_at: null,
    },
    {
      id: 107, rule_id: "HIGH", status: "open", severity: "medium",
      summary: "Radiology finalized a changed CT impression on Bed 12 — your team hasn't opened it before rounds.",
      details: { kind: "high", key: "high/revised_read", distinct_values: ["impression revised", "not opened"], per_source: {
        pacs: [ev("pacs", "high", 5113, 9113, "report", "ward: Bed 12 CT read (PACS)", "impression revised", 1.0, "final impression differs from preliminary")],
        epic: [ev("epic", "high", 5114, 9114, "note", "ward: Bed 12 chart (Epic)", "not opened", 0.7, "revised read not yet opened by the team")],
      } },
      opened_at: ago(3 * 60), closed_at: null,
    },
    {
      id: 108, rule_id: "HIGH", status: "open", severity: "medium",
      summary: "Tumour-board (colon) packet lacks final pathology sign-out; the genomic report is sitting in an external portal.",
      details: { kind: "high", key: "high/path_signout", distinct_values: ["pathology pending", "genomics external"], per_source: {
        labs: [ev("labs", "high", 5115, 9115, "pathology", "mdt: colon case pathology (Labs)", "pathology pending", 1.0, "final sign-out not yet released")],
        epic: [ev("epic", "high", 5116, 9116, "conference", "mdt: colon case packet (Epic)", "genomics external", 0.7, "genomic report in an outside portal")],
      } },
      opened_at: ago(6 * 60), closed_at: null,
    },
    /* ---------------- PENDING (what he owes) ---------------- */
    {
      id: 109, rule_id: "PENDING", status: "open", severity: "high",
      summary: "Bed 3 discharge order is signed, but home-oxygen approval is still pending and the SNF packet is incomplete.",
      details: { kind: "pending", key: "pending/discharge_barrier", distinct_values: ["order signed", "oxygen/SNF pending"], per_source: {
        epic: [ev("epic", "pending", 5117, 9117, "order", "ward: Bed 3 discharge order (Epic)", "order signed", 1.0, "discharge order signed")],
        pager: [ev("pager", "pending", 5118, 9118, "message", "ward: Bed 3 case management (Secure Chat)", "oxygen/SNF pending", 0.8, "home-oxygen approval pending, SNF packet incomplete")],
      } },
      opened_at: ago(2 * 60), closed_at: null,
    },
    {
      id: 110, rule_id: "PENDING", status: "open", severity: "medium",
      summary: "The rounds decision to hold anticoagulation on Bed 11 never reached pharmacy.",
      details: { kind: "pending", key: "pending/anticoag", distinct_values: ["hold decided at rounds", "pharmacy unaware"], per_source: {
        epic: [ev("epic", "pending", 5119, 9119, "note", "ward: Bed 11 rounds note (Epic)", "hold decided at rounds", 1.0, "team agreed to hold anticoagulation")],
        pager: [ev("pager", "pending", 5120, 9120, "message", "ward: Bed 11 pharmacy (Secure Chat)", "pharmacy unaware", 0.7, "no order change reached pharmacy")],
      } },
      opened_at: ago(4 * 60), closed_at: null,
    },
    {
      id: 111, rule_id: "PENDING", status: "open", severity: "medium",
      summary: "Last week's tumour-board recommendation (operate vs. defer biopsy) still hasn't become a scheduled OR action.",
      details: { kind: "pending", key: "pending/mdt_action", distinct_values: ["recommendation made", "not scheduled"], per_source: {
        epic: [ev("epic", "pending", 5121, 9121, "conference", "mdt: recommendation (Epic)", "recommendation made", 1.0, "board recommended operative plan")],
        sched: [ev("sched", "pending", 5122, 9122, "schedule", "mdt: OR scheduling (Scheduling)", "not scheduled", 0.7, "no OR action booked yet")],
      } },
      opened_at: ago(30 * 60), closed_at: null,
    },
    {
      id: 112, rule_id: "PENDING", status: "open", severity: "medium",
      summary: "PACU handoff for case 1 is pending — PACU has the procedure, not the intra-op concern that changes overnight monitoring.",
      details: { kind: "pending", key: "pending/pacu_handoff", distinct_values: ["procedure known", "intra-op concern missing"], per_source: {
        orboard: [ev("orboard", "pending", 5123, 9123, "board", "theatre: case 1 PACU handoff (OR Board)", "procedure known", 1.0, "PACU has the procedure")],
        pager: [ev("pager", "pending", 5124, 9124, "message", "theatre: case 1 handoff note (Secure Chat)", "intra-op concern missing", 0.7, "intra-op monitoring concern not conveyed")],
      } },
      opened_at: ago(80), closed_at: null,
    },
    {
      id: 113, rule_id: "PENDING", status: "open", severity: "low",
      summary: "A room opens for the revised 14:00 start, but scrub coverage for that slot isn't confirmed.",
      details: { kind: "pending", key: "pending/scrub_cover", distinct_values: ["room available", "scrub unconfirmed"], per_source: {
        orboard: [ev("orboard", "pending", 5125, 9125, "board", "theatre: 14:00 room (OR Board)", "room available", 1.0, "room opens for the revised start")],
        sched: [ev("sched", "pending", 5126, 9126, "staffing", "theatre: scrub coverage (Scheduling)", "scrub unconfirmed", 0.6, "scrub coverage for 14:00 not confirmed")],
      } },
      opened_at: ago(52 * 60), closed_at: null,
    },
    /* ---------------- REQUEST (inbound, waiting on him) ---------------- */
    {
      id: 114, rule_id: "REQUEST", status: "open", severity: "medium",
      summary: "Family for Bed 3 is asking for an update — the decision-maker / spokesperson isn't documented in the chart.",
      details: { kind: "request", key: "request/family_update", distinct_values: ["family asking", "spokesperson undocumented"], per_source: {
        pager: [ev("pager", "request", 5127, 9127, "message", "family: Bed 3 family request (Secure Chat)", "family asking", 1.0, "family requesting an update")],
        epic: [ev("epic", "request", 5128, 9128, "note", "family: Bed 3 chart (Epic)", "spokesperson undocumented", 0.7, "no decision-maker recorded")],
      } },
      opened_at: ago(45), closed_at: null,
    },
    {
      id: 115, rule_id: "REQUEST", status: "open", severity: "medium",
      summary: "ED is paging for disposition on a query-appendicitis consult — outside imaging is referenced but not yet in your viewer.",
      details: { kind: "request", key: "request/ed_consult", distinct_values: ["ED disposition page", "imaging not in viewer"], per_source: {
        pager: [ev("pager", "request", 5129, 9129, "page", "ed: query appendicitis (Secure Chat)", "ED disposition page", 1.0, "ED paging for surgical disposition")],
        pacs: [ev("pacs", "request", 5130, 9130, "study", "ed: outside imaging (PACS)", "imaging not in viewer", 0.7, "referenced CT not imported")],
      } },
      opened_at: ago(30), closed_at: null,
    },
    {
      id: 116, rule_id: "REQUEST", status: "open", severity: "low",
      summary: "Scheduling is asking you to confirm the operative-plan change from tumour board — scheduling, anaesthesia, and family comms aren't aligned yet.",
      details: { kind: "request", key: "request/plan_confirm", distinct_values: ["confirmation requested", "not aligned"], per_source: {
        sched: [ev("sched", "request", 5131, 9131, "schedule", "clinic: operative-plan change (Scheduling)", "confirmation requested", 1.0, "scheduling asking to confirm the change")],
        epic: [ev("epic", "request", 5132, 9132, "note", "clinic: plan alignment (Epic)", "not aligned", 0.6, "anaesthesia and family comms not aligned")],
      } },
      opened_at: ago(40 * 60), closed_at: null,
    },
    /* ---------------- closed (auto-reconverged) ---------------- */
    {
      id: 90, rule_id: "HIGH", status: "closed", severity: "medium",
      summary: "theatre: OR-1 pre-op imaging confirmed in the viewer.",
      details: { kind: "high", key: "high/preop_imaging", distinct_values: ["confirmed"], per_source: {
        pacs: [ev("pacs", "high", 5090, 9090, "study", "theatre: OR-1 pre-op imaging (PACS)", "confirmed", 1.0, "imaging imported and confirmed")],
      } },
      opened_at: ago(6 * 24 * 60), closed_at: ago(2 * 24 * 60),
    },
  ];
}

function buildResolved() {
  return [
    { id: 80, rule_id: "HIGH", severity: "high" as const, summary: "ICU bed for case 2 confirmed and accepted by the intensivist",
      details: { kind: "high", key: "high/icu_bed", distinct_values: ["bed accepted"] },
      opened_at: ago(4 * 24 * 60), resolved_at: ago(2 * 24 * 60), resolved_by: "Dr. Reyes — ICU Intensivist" },
    { id: 81, rule_id: "PENDING", severity: "medium" as const, summary: "Pre-op checklist for OR-1 completed and confirmed with anaesthesia",
      details: { kind: "pending", key: "pending/preop_checklist", distinct_values: ["complete"] },
      opened_at: ago(5 * 24 * 60), resolved_at: ago(30 * 60), resolved_by: "Anaesthesiologist" },
    { id: 82, rule_id: "REQUEST", severity: "medium" as const, summary: "Family goals-of-care conversation for Bed 5 documented with a named spokesperson",
      details: { kind: "request", key: "request/family_update", distinct_values: ["documented"] },
      opened_at: ago(6 * 24 * 60), resolved_at: ago(22 * 60), resolved_by: "Case Manager / Social Work" },
  ];
}

function findingDetail(id: number) {
  const f = buildFindings().find((x) => x.id === id);
  if (f) {
    const evidence = Object.values(f.details?.per_source ?? {}).flat().map((e) => ({
      role: "primary", claim_id: e.claim_id, kind: f.details?.kind ?? "", key: f.details?.key ?? "",
      value_norm: e.value_norm, value: e.value, confidence: e.confidence, extractor_id: e.extractor_id,
      source_anchor: { kind: e.source_anchor.kind, artifact_id: e.artifact_id, snippet: e.source_anchor.snippet },
    }));
    return { ...f, claim_group: { id: 700 + (id % 100), kind: f.details?.kind ?? "", key: f.details?.key ?? "", project_id: null }, evidence };
  }
  const r = buildResolved().find((x) => x.id === id);
  if (!r) return null;
  const srcs = ["epic", "pacs", "pager"];
  const evidence = (r.details.distinct_values ?? []).map((val, i) => ({
    role: "primary", claim_id: 5800 + id * 10 + i, kind: r.details.kind, key: r.details.key,
    value_norm: val, value: val, confidence: i === 0 ? 1.0 : 0.7,
    extractor_id: `${srcs[i % srcs.length]}.${r.details.kind}`,
    source_anchor: { kind: "span" as const, artifact_id: 9800 + id * 10 + i, snippet: val },
  }));
  return {
    id: r.id, rule_id: r.rule_id, status: "snoozed" as const, severity: r.severity, summary: r.summary,
    details: { kind: r.details.kind, key: r.details.key, distinct_values: r.details.distinct_values, per_source: {} },
    opened_at: r.opened_at, closed_at: null,
    claim_group: { id: 700 + (r.id % 100), kind: r.details.kind, key: r.details.key, project_id: null },
    evidence,
  };
}

function findingsSummary(all: Finding[]) {
  const open = all.filter((f) => f.status === "open");
  const closed = all.filter((f) => f.status === "closed");
  const open_by_rule: Record<string, number> = {};
  for (const f of open) open_by_rule[f.rule_id] = (open_by_rule[f.rule_id] ?? 0) + 1;
  return { open: open.length, closed: closed.length, open_by_rule, last_open_at: open.length ? open.map((f) => f.opened_at).sort().at(-1) : null };
}

const CONNECTIONS = [
  { id: 1, source: "epic", account_label: "Epic (MGB eCare) — orders, in-basket, OpTime", artifact_count: 612 },
  { id: 2, source: "pacs", account_label: "Visage 7 PACS + Nuance reads", artifact_count: 138 },
  { id: 3, source: "orboard", account_label: "OR Board (OpTime) — sequencing & turnover", artifact_count: 94 },
  { id: 4, source: "pager", account_label: "Secure Chat / paging", artifact_count: 203 },
  { id: 5, source: "labs", account_label: "Beaker LIS — results & critical values", artifact_count: 156 },
  { id: 6, source: "sched", account_label: "Cadence — OR & clinic scheduling", artifact_count: 61 },
];

export function demoJson(path: string): unknown | undefined {
  if (!DEMO_ENABLED) return undefined;
  const [p, q = ""] = path.split("?");
  const qs = new URLSearchParams(q);
  const all = buildFindings();

  if (p === "/api/graph/projects") return { projects: PROJECTS };
  if (p === "/api/graph/persons") return { persons: PERSONS };
  if (p === "/api/graph/people-projects") return { items: EDGES };
  if (p === "/api/graph/summary") {
    return { counts: { persons: PERSONS.length, projects: PROJECTS.length, artifacts: 783,
        person_identities: 22, project_sources: 14, artifact_mentions: 1610, raw_pending_normalization: 0 },
      last_raw_fetched_at: ago(4), last_normalized_at: ago(6) };
  }
  if (p === "/api/agent/status") {
    return { provider: "groq", model: "llama-3.3-70b-versatile", last_run_at: ago(9), last_ok_at: ago(9),
      total_runs: 96, total_briefs: 240, in_progress: 0 };
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

export function demoMutation(path: string, method: string): Response | undefined {
  if (!DEMO_ENABLED || method.toUpperCase() !== "POST") return undefined;
  const p = path.split("?")[0];
  if (/^\/api\/findings\/\d+\/(dealt-with|reopen)$/.test(p)) {
    return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return undefined;
}
