/**
 * Demo dataset — Dr. Shan Siddiqi (single-doctor ICP).
 *
 * Dr. Siddiqi is a research-dominant physician-scientist (neuromodulation:
 * TMS/DBS) standing up a NEW lab at Northwestern while relocating from
 * Brigham/CBCT, running multiple trials, carrying K23/R01/R21 grants, hiring a
 * team from ~zero, and running a national Brain Stimulation subspecialty
 * summit. His Husn wedge is his OPERATIONAL life — non-PHI, time-bound:
 * "what changed, who owns it, what's blocked" across the tools his team uses.
 *
 * Everything here is grounded in the master briefing:
 *   /Users/bawani/idea/hopital_idea/shan_siddiqi_master_briefing.md
 * The only hard identifiers that exist in the source are the two NCT numbers
 * and the grant mechanisms; no PHI/patient data is invented.
 *
 * Findings are categorised by rule_id into the four home "vitals":
 *   BLOCKED      → waiting on exactly one pending step (unread analysis, ...)
 *   DEADLINE     → a hard date in the next ~2 weeks (grant / IRB / summit)
 *   UNOWNED      → orphaned by the Brigham→Northwestern move
 *   NOT-LANDED   → decided/approved but not yet propagated downstream
 *   NEEDS-YOU    → the pending step is Dr. Siddiqi himself (a call / sign-off)
 *
 * TO DISABLE: set NEXT_PUBLIC_DEMO_TENANT to anything but "mclean" at build
 * time, or flip DEMO_ENABLED below. Off => serverJson/clientFetch hit the
 * live API unchanged.
 */

export const DEMO_ENABLED = (process.env.NEXT_PUBLIC_DEMO_TENANT ?? "mclean") === "mclean";

/** ISO timestamp `mins` minutes before now (fresh per request so "opened 3h
 *  ago" and the deadline framing stay live). */
function ago(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

/* ------------------------------------------------------------- workstreams */
/* "projects" in the data model == his operational workstreams. Slugs are
 * single tokens so the finding→workstream title-substring match lights up. */
const PROJECTS = [
  { id: 1, slug: "northwestern", name: "Northwestern Lab Launch", artifact_count: 214,
    scopes: [{ source: "outlook", kind: "thread", id: "move" }, { source: "calendar", kind: "cal", id: "move" }] },
  { id: 2, slug: "hiring", name: "Lab Hiring — RA · Lab Manager · Neuroimaging Faculty", artifact_count: 88,
    scopes: [{ source: "outlook", kind: "thread", id: "hiring" }, { source: "slack", kind: "channel", id: "hiring" }] },
  { id: 3, slug: "tms", name: "Symptom-Specific TMS Trial (NCT04604210)", artifact_count: 176,
    scopes: [{ source: "redcap", kind: "project", id: "NCT04604210" }, { source: "irb", kind: "protocol", id: "tms" }] },
  { id: 4, slug: "tbi", name: "TBI-Depression rTMS Trial (NCT02980484)", artifact_count: 132,
    scopes: [{ source: "ctms", kind: "study", id: "NCT02980484" }, { source: "irb", kind: "protocol", id: "tbi" }] },
  { id: 5, slug: "grants", name: "Grant Portfolio — K23 · R01 · R21", artifact_count: 143,
    scopes: [{ source: "era", kind: "portfolio", id: "grants" }, { source: "calendar", kind: "cal", id: "grants" }] },
  { id: 6, slug: "summit", name: "Brain Stimulation Subspecialty Summit", artifact_count: 121,
    scopes: [{ source: "zoom", kind: "meetings", id: "summit" }, { source: "outlook", kind: "thread", id: "summit" }] },
  { id: 7, slug: "collaborators", name: "Collaborator & Cross-Clinic Sync", artifact_count: 97,
    scopes: [{ source: "outlook", kind: "thread", id: "collab" }, { source: "zoom", kind: "meetings", id: "collab" }] },
];

/* --------------------------------------------------------- lab & collaborators */
function person(id: number, name: string, email: string, sources: string[]) {
  return {
    id, primary_name: name, primary_email: email,
    identities: sources.map((source) => ({ source, display_name: name, email })),
  };
}
const PERSONS = [
  person(1, "Michael Fox, MD, PhD — Mentor (CBCT)", "michael.fox@bwh.harvard.edu", ["outlook", "slack"]),
  person(2, "Samantha Baldi, PhD — Postdoc · target-engagement lead", "samantha.baldi@bwh.harvard.edu", ["redcap", "slack", "outlook"]),
  person(3, "Joe Taylor, MD, PhD — Clinical research fellow", "joe.taylor@bwh.harvard.edu", ["redcap", "outlook"]),
  person(4, "Suyeong Lee — Preclinical (Alzheimer's) lead", "suyeong.lee@bwh.harvard.edu", ["redcap", "slack"]),
  person(5, "Christopher Lin — Research staff", "christopher.lin@bwh.harvard.edu", ["drive", "slack"]),
  person(6, "Summer Frandsen — Research staff", "summer.frandsen@bwh.harvard.edu", ["drive", "outlook"]),
  person(7, "Amir Khosravani — Postdoc", "amir.khosravani@bwh.harvard.edu", ["redcap", "slack"]),
  person(8, "Jae Kwon — Postdoc", "jae.kwon@bwh.harvard.edu", ["redcap", "slack"]),
  person(9, "Anna Webler — Postdoc", "anna.webler@bwh.harvard.edu", ["drive", "slack"]),
  person(10, "Dr. Pines — Junior faculty", "pines@bwh.harvard.edu", ["outlook", "redcap"]),
  person(11, "Dr. Makhlouf — Junior faculty", "makhlouf@bwh.harvard.edu", ["outlook", "slack"]),
  person(12, "Nolan Williams, MD — Stanford SAINT (collaborator)", "nolan.williams@stanford.edu", ["zoom", "outlook"]),
  person(13, "Grants Administrator — Feinberg", "grants.admin@northwestern.edu", ["era", "outlook"]),
  person(14, "IRB Coordinator — Brigham", "irb.coordinator@bwh.harvard.edu", ["irb", "outlook"]),
];

function edge(person_id: number, project_id: number, total: number, dominant_role: string) {
  return { person_id, project_id, total, dominant_role };
}
const EDGES = [
  edge(1, 1, 24, "author"), edge(1, 7, 18, "mention"),
  edge(2, 3, 33, "author"), edge(2, 1, 9, "mention"),
  edge(3, 3, 21, "assignee"), edge(3, 4, 12, "mention"),
  edge(4, 4, 27, "author"), edge(4, 5, 8, "mention"),
  edge(7, 3, 16, "assignee"), edge(8, 4, 14, "assignee"), edge(9, 6, 11, "mention"),
  edge(10, 5, 13, "author"), edge(11, 6, 15, "author"),
  edge(12, 7, 19, "author"), edge(12, 3, 7, "mention"),
  edge(13, 5, 22, "assignee"), edge(14, 3, 17, "assignee"), edge(14, 4, 12, "assignee"),
  edge(5, 2, 10, "author"), edge(6, 6, 9, "assignee"),
];

/* -------------------------------------------------------------- coordination */
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

/* Each finding.summary is a full one-line proactive alert (the doctor reads the
 * alert, not a terse title). rule_id = the home vital it rolls up into. */
function buildFindings(): Finding[] {
  return [
    /* ---------------- NEEDS-YOU (the pending step is him) ---------------- */
    {
      id: 101, rule_id: "NEEDS-YOU", status: "open", severity: "high",
      summary: "The RA search for the Northwestern lab has two candidate replies waiting on your decision.",
      details: { kind: "decision", key: "hiring/ra_reply", distinct_values: ["2 replies waiting", "no decision yet"], per_source: {
        outlook: [ev("outlook", "decision", 5101, 9101, "email", "hiring — RA candidate replies (Email)", "2 replies waiting", 1.0, "two candidates responded; both need a yes/no from you")],
        slack: [ev("slack", "decision", 5102, 9102, "message", "hiring — #lab-hiring thread (Slack)", "no decision yet", 0.7, "waiting on Shan to pick who to bring in for a call")],
      } },
      opened_at: ago(90), closed_at: null,
    },
    {
      id: 102, rule_id: "NEEDS-YOU", status: "open", severity: "medium",
      summary: "The K23 budget justification needs your sign-off before Feinberg's grants office can submit.",
      details: { kind: "decision", key: "grants/k23_signoff", distinct_values: ["awaiting PI sign-off"], per_source: {
        era: [ev("era", "decision", 5103, 9103, "form", "grants — K23 budget justification (eRA)", "awaiting PI sign-off", 1.0, "budget justification drafted; PI approval outstanding")],
        outlook: [ev("outlook", "decision", 5104, 9104, "email", "grants — Feinberg grants office (Email)", "awaiting PI sign-off", 0.8, "we can submit as soon as you approve the justification")],
      } },
      opened_at: ago(6 * 60), closed_at: null,
    },
    /* ---------------- UNOWNED (orphaned by the move) ---------------- */
    {
      id: 103, rule_id: "UNOWNED", status: "open", severity: "high",
      summary: "IRB continuing review for NCT04604210 has no Northwestern owner — it was held by the Brigham coordinator.",
      details: { kind: "move", key: "move/irb_owner", distinct_values: ["Brigham coordinator", "no NU owner"], per_source: {
        irb: [ev("irb", "move", 5105, 9105, "record", "tms — IRB continuing review (Brigham)", "Brigham coordinator", 1.0, "continuing review owner: Brigham IRB coordinator")],
        outlook: [ev("outlook", "move", 5106, 9106, "email", "tms — transition thread (Email)", "no NU owner", 0.7, "nobody at Northwestern has picked this up yet")],
      } },
      opened_at: ago(20 * 60), closed_at: null,
    },
    {
      id: 104, rule_id: "UNOWNED", status: "open", severity: "high",
      summary: "NCT02980484 still lists Brigham as site of record while the lab relocates — the PI-of-record handoff is unconfirmed.",
      details: { kind: "move", key: "move/site_record", distinct_values: ["Brigham site of record", "Northwestern pending"], per_source: {
        ctms: [ev("ctms", "move", 5107, 9107, "study", "tbi — study site record", "Brigham site of record", 1.0, "site of record: Brigham and Women's")],
        outlook: [ev("outlook", "move", 5108, 9108, "email", "tbi — site transfer thread (Email)", "Northwestern pending", 0.7, "transfer to Feinberg discussed, not yet filed")],
      } },
      opened_at: ago(28 * 60), closed_at: null,
    },
    {
      id: 105, rule_id: "UNOWNED", status: "open", severity: "medium",
      summary: "R01 'two-R01' PRODEP effort and budget still route to Brigham post-move — the allocation is unreconciled between institutions.",
      details: { kind: "move", key: "move/prodep_alloc", distinct_values: ["Brigham allocation", "Northwestern unreconciled"], per_source: {
        era: [ev("era", "move", 5109, 9109, "record", "grants — PRODEP R01 effort (eRA)", "Brigham allocation", 1.0, "effort still committed at prior institution")],
        outlook: [ev("outlook", "move", 5110, 9110, "email", "grants — grants admin thread (Email)", "Northwestern unreconciled", 0.7, "need to re-split effort once the move is official")],
      } },
      opened_at: ago(30 * 60), closed_at: null,
    },
    {
      id: 106, rule_id: "UNOWNED", status: "open", severity: "medium",
      summary: "Baldi's target-engagement analysis has no confirmed owner if she doesn't relocate — the study could be orphaned.",
      details: { kind: "move", key: "move/baldi_owner", distinct_values: ["Baldi (relocation unclear)", "no backup owner"], per_source: {
        redcap: [ev("redcap", "move", 5111, 9111, "project", "tms — target-engagement analysis (REDCap)", "Baldi (relocation unclear)", 1.0, "sole analyst; relocation not decided")],
        slack: [ev("slack", "move", 5112, 9112, "message", "tms — #tms-analysis (Slack)", "no backup owner", 0.6, "nobody else is set up to run this if Sam stays")],
      } },
      opened_at: ago(34 * 60), closed_at: null,
    },
    /* ---------------- BLOCKED (waiting on one step) ---------------- */
    {
      id: 107, rule_id: "BLOCKED", status: "open", severity: "high",
      summary: "The target-engagement results are blocked on an imaging-QC output nobody has opened in 6 days.",
      details: { kind: "blocked", key: "blocked/imaging_qc", distinct_values: ["QC ready", "unopened 6 days"], per_source: {
        drive: [ev("drive", "blocked", 5113, 9113, "file", "tms — imaging QC report (Drive)", "QC ready", 1.0, "QC output posted 6 days ago")],
        redcap: [ev("redcap", "blocked", 5114, 9114, "project", "tms — analysis pipeline (REDCap)", "unopened 6 days", 0.8, "downstream analysis paused pending QC review")],
      } },
      opened_at: ago(45), closed_at: null,
    },
    {
      id: 108, rule_id: "BLOCKED", status: "open", severity: "medium",
      summary: "Lab-manager onboarding (IRB delegation, REDCap access) is blocked on the unfilled seat — the offer has been out 6 days.",
      details: { kind: "blocked", key: "blocked/labmgr_offer", distinct_values: ["offer outstanding 6 days", "onboarding blocked"], per_source: {
        outlook: [ev("outlook", "blocked", 5115, 9115, "email", "hiring — lab manager offer (Email)", "offer outstanding 6 days", 1.0, "candidate hasn't accepted; offer sent 6 days ago")],
        irb: [ev("irb", "blocked", 5116, 9116, "record", "hiring — IRB delegation queue (IRB)", "onboarding blocked", 0.7, "IRB delegation waits on a named lab manager")],
      } },
      opened_at: ago(5 * 60), closed_at: null,
    },
    /* ---------------- DEADLINE (hard date, ≤ 2 weeks) ---------------- */
    {
      id: 109, rule_id: "DEADLINE", status: "open", severity: "high",
      summary: "The K23 non-competing renewal / progress report is due in 9 days and the transfer paperwork isn't started.",
      details: { kind: "deadline", key: "deadline/k23_report", distinct_values: ["due in 9 days", "not started"], per_source: {
        era: [ev("era", "deadline", 5117, 9117, "record", "grants — K23 progress report (eRA)", "due in 9 days", 1.0, "RPPR due date is 9 days out")],
        calendar: [ev("calendar", "deadline", 5118, 9118, "event", "grants — deadline calendar", "not started", 0.8, "no draft on the shared drive yet")],
      } },
      opened_at: ago(3 * 60), closed_at: null,
    },
    {
      id: 110, rule_id: "DEADLINE", status: "open", severity: "medium",
      summary: "An R21 milestone deadline is 12 days out with no assigned owner since the move.",
      details: { kind: "deadline", key: "deadline/r21_milestone", distinct_values: ["due in 12 days", "no owner"], per_source: {
        era: [ev("era", "deadline", 5119, 9119, "record", "grants — R21 milestone (eRA)", "due in 12 days", 1.0, "milestone report window opens now")],
        calendar: [ev("calendar", "deadline", 5120, 9120, "event", "grants — deadline calendar", "no owner", 0.7, "driver rotated out with the move")],
      } },
      opened_at: ago(9 * 60), closed_at: null,
    },
    {
      id: 111, rule_id: "DEADLINE", status: "open", severity: "medium",
      summary: "The Brain Stimulation Summit accreditation filing closes in 8 days and the volunteer owner is ambiguous.",
      details: { kind: "deadline", key: "deadline/summit_filing", distinct_values: ["closes in 8 days", "owner ambiguous"], per_source: {
        zoom: [ev("zoom", "deadline", 5121, 9121, "meeting", "summit — organizer sync (Zoom)", "closes in 8 days", 0.8, "accreditation filing window closes next week")],
        outlook: [ev("outlook", "deadline", 5122, 9122, "email", "summit — volunteers thread (Email)", "owner ambiguous", 0.7, "unclear which volunteer is filing")],
      } },
      opened_at: ago(26 * 60), closed_at: null,
    },
    /* ---------------- NOT-LANDED (decided, not propagated) ---------------- */
    {
      id: 112, rule_id: "NOT-LANDED", status: "open", severity: "high",
      summary: "The NCT04604210 IRB amendment is approved but hasn't reached the site visit calendar yet.",
      details: { kind: "landed", key: "landed/amendment_calendar", distinct_values: ["IRB approved", "calendar unchanged"], per_source: {
        irb: [ev("irb", "landed", 5123, 9123, "record", "tms — IRB amendment approval (IRB)", "IRB approved", 1.0, "amendment approved Monday")],
        redcap: [ev("redcap", "landed", 5124, 9124, "project", "tms — visit calendar (REDCap)", "calendar unchanged", 0.8, "visit windows still reflect the old protocol")],
      } },
      opened_at: ago(50), closed_at: null,
    },
    {
      id: 113, rule_id: "NOT-LANDED", status: "open", severity: "medium",
      summary: "The accelerated-TMS (AI4) targeting change hasn't been acknowledged by the Stanford SAINT collaborator.",
      details: { kind: "landed", key: "landed/ai4_ack", distinct_values: ["change sent", "no acknowledgement"], per_source: {
        outlook: [ev("outlook", "landed", 5125, 9125, "email", "collaborators — AI4 targeting update (Email)", "change sent", 1.0, "targeting change emailed to SAINT")],
        zoom: [ev("zoom", "landed", 5126, 9126, "meeting", "collaborators — SAINT sync (Zoom)", "no acknowledgement", 0.6, "not confirmed on the last call")],
      } },
      opened_at: ago(40 * 60), closed_at: null,
    },
    {
      id: 114, rule_id: "NOT-LANDED", status: "open", severity: "low",
      summary: "An updated SOP hasn't propagated to the cross-clinic collaborators (BPN, McLean, Brigham).",
      details: { kind: "landed", key: "landed/sop_propagation", distinct_values: ["SOP updated", "sites unaware"], per_source: {
        drive: [ev("drive", "landed", 5127, 9127, "file", "collaborators — updated SOP (Drive)", "SOP updated", 1.0, "SOP revised on the shared drive")],
        outlook: [ev("outlook", "landed", 5128, 9128, "email", "collaborators — sites distribution (Email)", "sites unaware", 0.6, "no acknowledgement logged from downstream sites")],
      } },
      opened_at: ago(52 * 60), closed_at: null,
    },
    /* ---------------- closed (auto-reconverged; shown in Explore → all) ---- */
    {
      id: 90, rule_id: "NOT-LANDED", status: "closed", severity: "medium",
      summary: "summit — speaker confirmations reconciled across email and Zoom invites.",
      details: { kind: "landed", key: "landed/summit_speakers", distinct_values: ["reconciled"], per_source: {
        outlook: [ev("outlook", "landed", 5090, 9090, "email", "summit — speaker confirmations (Email)", "reconciled", 1.0, "invites and email list now match")],
      } },
      opened_at: ago(6 * 24 * 60), closed_at: ago(2 * 24 * 60),
    },
  ];
}

/* "Dealt with" folder → /api/findings/resolved */
function buildResolved() {
  return [
    { id: 80, rule_id: "UNOWNED", severity: "high" as const, summary: "Postdoc offboarding checklist ownership assigned before the move",
      details: { kind: "move", key: "move/offboarding", distinct_values: ["assigned to Taylor"] },
      opened_at: ago(4 * 24 * 60), resolved_at: ago(2 * 24 * 60), resolved_by: "Shan Siddiqi, MD" },
    { id: 81, rule_id: "DEADLINE", severity: "medium" as const, summary: "R01 effort report submitted on eRA Commons",
      details: { kind: "deadline", key: "deadline/effort_report", distinct_values: ["submitted"] },
      opened_at: ago(5 * 24 * 60), resolved_at: ago(30 * 60), resolved_by: "Grants Administrator — Feinberg" },
    { id: 82, rule_id: "NOT-LANDED", severity: "medium" as const, summary: "Summit registration link propagated to all co-organizers",
      details: { kind: "landed", key: "landed/summit_reg", distinct_values: ["propagated"] },
      opened_at: ago(6 * 24 * 60), resolved_at: ago(22 * 60), resolved_by: "Shan Siddiqi, MD" },
  ];
}

/* Investigation detail: flatten per_source into evidence[]; resolves live
 * findings AND resolved items so no demo link 404s. */
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
  const srcs = ["outlook", "redcap", "era"];
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
  { id: 1, source: "outlook", account_label: "Institutional Email & Calendar (Outlook)", artifact_count: 486 },
  { id: 2, source: "slack", account_label: "Lab Slack — #lab-hiring · #tms-analysis", artifact_count: 213 },
  { id: 3, source: "zoom", account_label: "Zoom — summit & collaborator syncs", artifact_count: 74 },
  { id: 4, source: "redcap", account_label: "REDCap — trial data capture", artifact_count: 158 },
  { id: 5, source: "era", account_label: "NIH eRA Commons — grant records", artifact_count: 61 },
  { id: 6, source: "drive", account_label: "Shared Drive — analyses, SOPs, drafts", artifact_count: 132 },
];

/** Resolve a demo payload for a server-side API path, or undefined to fall
 *  through to the live API (auth, mutations, anything not owned here). */
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
      counts: { persons: PERSONS.length, projects: PROJECTS.length, artifacts: 971,
        person_identities: 26, project_sources: 14, artifact_mentions: 1840, raw_pending_normalization: 0 },
      last_raw_fetched_at: ago(6), last_normalized_at: ago(8),
    };
  }
  if (p === "/api/agent/status") {
    return { provider: "groq", model: "llama-3.3-70b-versatile", last_run_at: ago(12), last_ok_at: ago(12),
      total_runs: 61, total_briefs: 130, in_progress: 0 };
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
 * buttons on demo findings succeed instead of 404-ing against the live API.
 */
export function demoMutation(path: string, method: string): Response | undefined {
  if (!DEMO_ENABLED || method.toUpperCase() !== "POST") return undefined;
  const p = path.split("?")[0];
  if (/^\/api\/findings\/\d+\/(dealt-with|reopen)$/.test(p)) {
    return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return undefined;
}
