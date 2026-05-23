# husn.io — Knowledge Base

Concise, researched, skeptical. Synthesised from 4 parallel research streams (market, personas, business, legal/tech). Sources at the end of each section, not inline.

---

## 1. Problem

Large companies (1.5K–8K employees) fail at cross-functional execution not because information is missing but because **operational changes do not propagate into shared understanding** across the tools where work actually lives — Jira, Slack, Confluence, Google Docs, Gmail/Outlook, meeting transcripts. A launch date moves in Jira on Tuesday; the LRR deck still says the old date; QA lives in a different Slack channel and never sees it; Security's review is stale because the architecture quietly changed. The Technical Program Manager (TPM) is paid, in effect, to be a **human diff tool** across these sources, and ~25% of their week goes to chasing status. husn.io exists to detect drift, identify who hasn't acknowledged a change, and produce evidence-backed alignment state — before the next sync.

---

## 2. Market & Competitor Gap

### Categories on the board today
- **Project/work mgmt:** Jira, Asana, Linear, ClickUp, Height
- **Portfolio / OKR:** Jira Align, Microsoft Viva Goals, Asana Goals, Tability
- **Work hubs / docs:** Notion, Coda, Confluence, Microsoft Loop
- **Enterprise search / Work AI:** Glean (~$200M ARR 2025, $7B+ valuation), Microsoft Copilot, Slack AI, Doti (acquired by Salesforce)
- **AI meetings:** Granola, Fireflies, Otter, **Read.ai (~$81M raised, F500 footprint, closest analog on ingestion breadth)**
- **Operational graph (emerging):** **Interloom** ($16.5M seed Mar 2026, "context graph"), Modern Relay ($3M seed, "Omnigraph")

### The honest gap (4–6 things nobody does well today)
1. **Claim-level reconciliation across sources.** Nothing today compares structured claims (e.g. "ship date = June 10" in Jira vs. "June 3" in deck) and flags the conflict. Drift is detected by humans in meetings.
2. **Propagation-of-change awareness.** "Jira ticket X changed → teams A, B, C affected, none have acknowledged" is not modelled by any incumbent. OKR tools track dependencies as static links, not propagation.
3. **Pre-meeting, per-persona briefs grounded in evidence.** Meeting AIs summarise *after*; Copilot briefs are generic; Fellow is template-based. None ground in conflicting source claims.
4. **Email + decks + transcripts as first-class operational signal** (not just a search corpus).
5. **TPM as buying persona / workflow.** A huge F500 role with no tool built for it.
6. **Operational graph as durable substrate** (vs. ephemeral chat context). Interloom is the first well-funded entrant.

### How husn.io most plausibly dies
1. **Atlassian Rovo absorbs it.** Teamwork Graph + Rovo agents on top of Jira/Confluence + MCP connectors are already shipping. They own the data and the procurement relationship. **Mitigation moat:** be the cross-tool layer Atlassian structurally can't be — because they don't own Slack/Gmail/Microsoft.
2. **Glean or Microsoft Copilot turns retrieval into proactive reconciliation.** Short path; both have permissioned graphs.
3. **Read.ai expands from "connected intelligence summaries" to TPM workflows.** Most adjacent independent.
4. **Slack/Salesforce ships native cross-tool drift detection.** Medium-high probability over 18 months. Kills the wedge.
5. **CIO consolidation reflex:** "Why another tool? Rovo already does this in our existing contract." Fatal unless the champion fights for it.
6. **Integration fragility:** one bad false-positive drift alert during a launch destroys trust permanently.

### Verdict on category
husn.io does not slot cleanly into any existing bucket. Most legible framing is **"AI TPM / operational intelligence for cross-functional programs."** Defensibility lives in **workflow opinionation** (pre-meeting brief, propagation+ack loop, evidence lineage), not in the graph itself.

---

## 3. Personas

### Primary — TPM / TPgM
- Senior IC (L5–L7), 5–12 yrs experience, no direct reports, influences without authority. Owns 1–4 cross-functional programs spanning 4–15 teams.
- **Time spend:** ~30–40% meetings, ~20–25% chasing status, ~15% writing status docs, ~10% triaging surprises, ~10% program design, ~5% relationships.
- **Lives in:** Jira (theoretical source of truth), Confluence (program pages), Slack/Teams (real signal), Google Docs/Sheets (RACI, dependency trackers), Outlook/Gmail (exec comms), Zoom/Gong/Otter (transcripts).
- **Top pains:** source-of-truth drift; acknowledgment is invisible; decisions hide in DMs/huddles; status theater (hand-rebuilding RAG every Thursday); surprise dependencies 2 weeks before launch.
- **Workarounds:** hand-authored Confluence status; stale Google Sheet RACI; DMs and gut feel.
- **Success in a quarter:** lands on committed date; no "I didn't know about that" from leadership; risks surfaced ≥4 weeks early; fewer status meetings.

### Secondary personas (all are **notification consumers**, not app-openers)
| Persona | Value | Opens app? |
|---|---|---|
| Eng Manager | Pre-digested deltas affecting their team | Rarely, 1–2x/wk |
| QA Lead | Alert when date/scope changes upstream | Sometimes |
| Security Lead | When architecture change invalidates prior review | Notifications + weekly view |
| Ops Manager | Vendor/SLA commitments in transcripts/docs | Occasional |
| Finance partner | Revenue-tied launches slipping | Rarely |
| Support Enablement Lead | "You have N fewer days for enablement" | Notification only |
| Customer Success | Internal slip vs. external commitment | Rarely |

**Implication:** husn.io's UX center of gravity is the **digest/alert layer**, not the dashboard. Underestimating that ratio is a classic coordination-tool failure (Asana/Monday outside PMs).

### Anti-personas (not for them)
- Sub-50-person startups (no drift to detect)
- Single-team eng orgs at large companies
- Self-organising / Spotify-true-believers
- Air-gapped / classified gov / defense
- Heavy waterfall / Microsoft Project PMO shops
- Agency / client-services orgs (cross-customer, not cross-team)

---

## 4. Use Cases / Failure Scenarios husn.io Catches

1. **Date drift across systems.** Jira moves to June 10 Tue; LRR Confluence page + Security ticket still say June 3; QA in #qa-eng not #project-atlas never sees it; regression window compresses to 2 days → P0 in week one.
2. **Decision in a DM.** PM + Tech Lead drop a sub-feature in a 1:1 huddle. Localization already shipped strings; $40K wasted; legal review reopened. *husn ingests transcript → detects scope-change → flags absence in formal record.*
3. **Stale architecture invalidates security sign-off.** Confluence design doc unchanged for 6 months; newer ADRs / PRs introduce a new third-party API. Security finds out at LRR. *husn: doc-of-record is older than referenced downstream artifacts + new vendor mention.*
4. **Customer commitment not tracked internally.** CSM emails top-10 customer "Feature X ships Q3"; internal planning silently descopes to Q4. Renewal at risk. *husn correlates outbound commitments with internal roadmap state.*
5. **Compliance blocker surfaced late.** New PII dataflow in design doc; no one routes Privacy. Three weeks before launch, Privacy says "we need 6 weeks." *husn rule: design-doc mentions PII/new region/new processor → ensure Privacy ack.*
6. **Downstream dependency surprise.** Platform team moves a lib upgrade from Sprint 14 → 16. Three consuming teams had it in a Sheet, not Jira. *husn maps cross-Jira-project links + sheet/doc references; alerts consumers when source moves.*
7. **Acknowledgment gap on rollout plan.** SRE posts runbook update in #sre; Support in #support-ops never sees; day-of, tickets pile up because Support has the old script.
8. **Conflicting metric definitions.** Finance defines "active user" one way in the board deck; Product defines it differently in QBR. Exec calls out the contradiction live. *(Stretch for v1 — semantic reconciliation harder than date/scope.)*

### JTBD
- When a date/scope changes anywhere, **I want to** know which downstream teams haven't acknowledged, **so I can** unblock them before the next sync.
- When prepping for steerco/LRR, **I want** every divergence between Jira, the program doc, and this week's Slack/transcripts surfaced, **so** I walk in with no blind spots.
- When a decision happens in a meeting/DM, **I want** it reconciled against the formal record, **so** I stop being the human ledger.
- When a new risk/dependency emerges anywhere, **I want** to be alerted with full context, **so** I route it within hours not weeks.
- When an exec asks "is project X on track?", **I want** a defensible source-linked answer in 60 seconds.

---

## 5. Business Model & ICP

### ICP
- **Headcount:** 1,500–8,000. Below 1,500 = solvable informally. Above 8,000 = captive build or Atlassian Teamwork Collection + Rovo.
- **ARR proxy:** $200M–$2B revenue.
- **Industry priority:** (1) B2B SaaS / vertical SaaS, (2) Fintech / payments (regulatory deadlines force coordination), (3) Healthtech / regulated infra. **Late:** biotech, traditional enterprise, defense.
- **Org markers:** ≥3 TPMs reporting into a Director of Eng Programs / Chief of Staff; runs quarterly planning; has weekly XFN sync or steerco ritual.
- **Tool-stack fit:**
  - **Tier 1 (canonical):** Slack + Jira + Confluence + Google Docs
  - **Tier 2 (workable):** Teams + Azure DevOps + SharePoint/Confluence — slower IT motion, weaker public APIs
  - **Poor fit:** Linear-only shops (too disciplined / too small to need it)

### Pricing — recommended
**Platform fee + editor (TPM) seats; viewers free up to 10× editors.**
- TPM editor seat: **$60/seat/mo annual** ($720/yr)
- Platform fee: **$40K/yr starter (≤500 employees in graph) → $80K mid (≤2,500) → $150K+ enterprise (≤10K)**
- Anchored slightly below Glean ($45–50/seat), well above Jira Premium ($14.54–17.50). Buyer compares to "what does one TPM cost fully loaded" ($180K), not "what does one Jira seat cost."
- **Avoid:** per-connector (punishes the thing that creates value); pure usage/credit pricing (procurement-hostile in 2026 post-Glean FlexCredits backlash).

### Sales motion
**Top-down enterprise sales with PLG-flavored champion path.** Not self-serve (security review kills it). Not pure top-down (value only legible after the graph indexes their data).
- **Champion:** Senior TPM / Director of Eng Programs
- **Economic buyer:** VP Engineering or Chief of Staff (owns "why programs are late"). Not CTO. Not COO unless non-tech.
- **Blockers:** CISO (Slack content exfil), Procurement (Atlassian consolidation pressure)
- **One-line pitch:** *"We catch the cross-team drift that makes your launches slip a quarter, before your TPMs notice it in a Slack thread three weeks late."*

### 12-month revenue path (honest)
| Quarter | Milestone | ARR |
|---|---|---|
| Q1 | 3 design partners signed (paid pilot @ $20K each, 6mo) | $60K booked, $0 ARR |
| Q2 | 1 DP → annual @ $80K | $80K ARR |
| Q3 | 3 DPs converted + 2 new paid | $400K ARR |
| Q4 | 10 paying @ $75K blended ACV | **~$750K ARR exit** |

Sales cycle: 90–120 days enterprise + 30–60 day security review = ~5 months first call → PO. Plan an 18-month bridge to $2–3M ARR before Series A.

### Design partner discipline
- **3, hard cap.** More fragments engineering attention.
- They get: 6 months free, dedicated FDE (founder), source-available propagation rules.
- They give: weekly 30-min review, quantified outcome by month 4, named reference, **auto-conversion to paid annual at month 7 — in writing upfront.**

---

## 6. Legal / Privacy / Compliance Posture

> **Three independent items reshape architecture and GTM. Read this section twice.**

### A. Slack API ToS (May 29, 2025) — **architecture-forcing**
- Bans use of Slack API data to train LLMs.
- Bans bulk export.
- Bans persistent copies / archives / indexes / long-term stores for **non-Marketplace** third-party apps.
- `conversations.history` for non-Marketplace apps = **Tier 1: 1 req/min, 15 msgs/call**. Marketplace/internal = Tier 3 + 1000 msgs/call.
- **Implication:** the "centralized SaaS pulls Slack data → graph → LLM" pattern is **prohibited as written**. Two viable architectures:
  1. **Customer-installed app per workspace** (their data, their tier, their LLM connection where possible).
  2. **Slack Marketplace-approved app** (3–9 month review, Slack openly cautious on LLM-adjacent).
  Bulk-pull-and-index is dead. Real-Time Search API is the on-demand alternative.

### B. CC'd shadow inbox (`ingest@husn.io`) — **kill it**
- Microsoft 365 default outbound policy + DLP **block external auto-forwarding** (NDR 5.7.520). Any competent CISO has this on.
- GDPR: ingesting third-party (non-employee) email senders without consent = no lawful basis; husn becomes joint controller.
- US two-party-consent states (CA, FL, IL, MA, MD, MT, NH, PA, WA): meaningful risk.
- **Replace with:** OAuth Gmail read-only scoped to labeled folders OR customer-tenant-installed Microsoft Graph subscriptions / Gmail Pub/Sub push.

### C. Restricted-scope verification (Gmail + M365 Cert) — **timeline-forcing**
- Reading mail bodies = restricted scope → annual **CASA** assessment. **~$500–$1.5K (Tier 2) / $4.5K–$7.5K (Tier 3)** per year. End-to-end OAuth verification + brand review + CASA = **3–6 months** for first-timer.
- Microsoft 365 Certification: free questionnaire but heavyweight; pen-test costs after 12 days; must complete in 60 days.
- Without these, customers get "unverified app" warnings → non-functional for enterprise.

### Other regulatory load
- **GDPR (EU/UK):** processor in most cases, **joint controller** for third-party email senders. Lawful basis = legitimate interest (Art. 6(1)(f)) but fragile for monitoring-flavored uses. Need per-channel/per-label allowlists (data minimization), DPAs, public subprocessor list. LLM provider must offer zero-retention enterprise endpoints (Anthropic enterprise, Azure OpenAI). DSAR/RTBF deletion by subject-identity across the operational graph — hard.
- **CCPA/CPRA:** B2B + employee exemptions expired Jan 2023. Need employee-facing notice-at-collection template for customers.
- **India DPDP (2023, Rules 2025):** "negative list" model for cross-border. Treat as GDPR-equivalent.
- **EU AI Act:** Annex III lists employment-monitoring AI as **high-risk**. Pre-meeting briefs that summarise "what each person said and didn't acknowledge" sit close to this line. Most HR obligations from **Aug 2, 2026**. Designing-to-avoid is much cheaper than complying-after. Guardrails: no individual scoring/ranking surfaces anywhere; briefs scoped to recipient's own meetings; contractual ban on using output in performance/disciplinary decisions.
- **German works councils (BetrVG § 87(1)6):** hard co-determination veto over "technical devices to monitor performance or behavior." Works Council Modernization Act 2021 explicitly extends to AI. Any German customer with works council → **Betriebsvereinbarung** required, +2–6 months. France CSE similar.
- **SOC 2 Type II:** table-stakes (83% of enterprise buyers require). **~$25–60K all-in year 1**, ~6 months MVP → Type II ready. Use Drata or Vanta.
- **ISO 27001:** +$15–30K incremental if EU-heavy.
- **HIPAA / FedRAMP:** ignore unless a vertical demands; FedRAMP would smother the company.

### Posture commitments to bake in from day 1
- Multi-region tenancy (EU + US + IN); customer-elected; no cross-region replication of raw content
- Per-subject deletion index (not just per-tenant)
- Hard retention windows (30/90/365 tiers)
- BYOK / customer-managed keys for restricted-scope payloads
- Explicit "no training on customer data" in MSA; subprocessor list reflects only zero-retention LLM endpoints
- Audit log of "who viewed which brief about whom"

---

## 7. Top Technical Risks + Mitigations

| # | Risk | Concrete 2025–26 numbers | Mitigation |
|---|---|---|---|
| 1 | **Slack non-Marketplace rate limits & ToS** | 1 req/min on `conversations.history`, 15 msgs/call; no persistent storage allowed | Customer-installed app per workspace; Real-Time Search API for on-demand retrieval; pursue Marketplace approval in parallel |
| 2 | **Jira Cloud rate limits** | 65,000 points/hour shared across all apps per site + per-endpoint burst; enforced from **Mar 2, 2026** | Backfill via paginated low-priority queue; webhook-first for ongoing; per-site quota tracking; consider Forge (gets "Runs on Atlassian" badge) |
| 3 | **Gmail / Drive restricted scopes + quotas** | CASA $0.5–7.5K/yr; Drive quota-units model from May 1, 2026 then metered; Gmail Pub/Sub TTL 7 days | Plan scopes precisely upfront (scope expansion = re-consent + re-CASA); reconcile-on-resume jobs; budget quota |
| 4 | **MS Graph throttling** | Outlook 10K req/10-min per app+mailbox (~16 rps); recommended 4–10 rps; per-tenant cap **halved Sep 30, 2025**. Teams: 4 rps per team, 1 rps per channel/chat | Adaptive rate limiter; per-tenant quota awareness; subscriptions over polling |
| 5 | **Webhooks at-least-once, not in-order** | All four platforms guarantee at-least-once delivery only | Idempotent writes keyed on (source, external-id, version); reconciliation jobs that pull canonical state |
| 6 | **Schema drift in source tools** | Jira custom fields per-tenant; Slack block-kit format evolves; Graph $select silently drops new fields | Per-tenant schema introspection on connect; canary tests on a sample artifact; soft-fail extraction with raw-source fallback |
| 7 | **Claim-extraction precision** | False-positive drift alerts destroy trust permanently; one bad call during a launch and the TPM mutes you forever | Deterministic rules first (regex/parsers for dates, owners, statuses), LLM as a second pass; precision over recall early; human-in-the-loop "confirm before notifying others"; per-program tuning |

---

## 8. Known Holes in the Idea (honest)

1. **The riskiest assumption:** TPMs will trust drift detection within 2 weeks. If precision isn't very high from day one, husn becomes a muted Slack bot. The product earns trust message-by-message; one bad week kills it.
2. **The riskiest persona claim:** secondary personas (eng managers, QA, security) will consume notifications gratefully. More likely they will perceive husn as the TPM's surveillance tool unless framing is deliberate. Anti-monitoring guardrails are not optional ornaments — they are the product.
3. **The biggest market constraint:** the buyer. TPMs influence, don't own budget. The deal must be sold on (a) reduced exec-surprise incidents or (b) replacing an existing PMO line item. "TPM productivity" alone doesn't close.
4. **Defensibility erodes from above, not below.** The real threats are incumbents (Atlassian Rovo, Microsoft Copilot, Glean, Read.ai) adding a feature, not other startups. 24–36 months of window. Buy-or-die clock is real.
5. **Slack ToS forces a re-architecture** vs. the original "centralized SaaS pulls everything" intuition. Customer-installed/per-workspace deployment is the path; this changes the engineering shape.
6. **CC'd shadow inbox was a romantic shortcut.** It does not work in the target market. Remove from the pitch.
7. **Founder-laptop MVP cannot legally onboard a real enterprise customer.** Procurement will reject. Minimum viable production posture (managed cloud, encryption, audit logs, SSO, MFA, SOC 2 evidence) must precede the first paid pilot.
8. **EU AI Act high-risk classification is a coin-flip we don't want to flip.** Product framing must deliberately avoid the monitoring envelope from day one. Once a "responsiveness leaderboard" exists in the UI, it leaks and the EU GTM dies.
9. **ACV math is borderline.** $75K blended needs editor-seat discipline + a $60K platform floor. Drift to $40K starter-heavy and the sales motion can't pay for itself.
10. **Champion-dependent revenue.** TPM champions change jobs every 18–24 months. Build a written success-plan handoff at month 9 of every contract.

---

## Sources (consolidated)

**Market & funding**
- Atlassian Rovo / Teamwork Graph at Team '26 — marketingscoop.com
- Read.ai $50M Series B announcement — read.ai
- Interloom seed — fortune.com (Mar 2026)
- Modern Relay seed — thesaasnews.com
- Glean autonomous agents — reworked.co
- Doti acquisition — martech.org

**TPM persona research**
- Mario Gerard, Chelsie Librun, LeadDev, Monzo blog day-in-the-life posts
- Middleware "Jira Hell" + automation
- TPM Academy collaboration responsibilities

**Pricing benchmarks**
- Atlassian Jira pricing — atlassian.com
- Glean pricing — gosearch.ai, vendr.com
- Productboard / Notion / Linear / Asana 2026 pricing pages

**Legal / API ToS**
- Slack ToS update May 29, 2025 — docs.slack.dev
- Atlassian Marketplace Partner Agreement Nov 30, 2025
- Jira rate limits — developer.atlassian.com
- Google CASA / restricted scope verification — developers.google.com, deepstrike.io
- Microsoft Graph throttling — learn.microsoft.com
- Microsoft 365 Certification — learn.microsoft.com
- EU AI Act Annex III — artificialintelligenceact.eu
- Crowell, Orrick, Bird & Bird on German co-determination + AI
- K&K on India DPDP cross-border framework
- Perkins Coie on CCPA employee exemption expiration
- Drata / Vanta on SOC 2 cost
