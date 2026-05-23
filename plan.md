# husn.io — Implementation Plan

> **Read `knowledge.md` first.** Three findings reshape the architecture before line 1 of code: (1) Slack ToS forbids centralized bulk pull → per-workspace install pattern, (2) CC'd shadow inbox is dead → OAuth-only for email, (3) anti-monitoring framing is product structure, not polish.

---

## Stack & Scope

- **Backend:** Python 3.12, **FastAPI**, **Pydantic v2**, **SQLAlchemy 2 (async)**, **Alembic** (migrations), **Arq** (Redis-backed job queue), **httpx**, **structlog**
- **Frontend:** **Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query**
- **Data:** **Postgres 16** (operational graph + raw artifacts), **Redis 7** (queue + cache), local **MinIO** for blob (transcripts, doc snapshots) — optional in Step 1
- **Auth (local MVP):** GitHub OAuth or magic-link — single user
- **LLM (later steps):** Anthropic Claude via SDK with zero-retention enterprise endpoint. Wrapped behind a `ClaimExtractor` interface so it's swappable.
- **Repo layout:** monorepo. `/api` (FastAPI), `/web` (Next.js), `/workers` (Arq), `/infra` (docker-compose, alembic, seed scripts)
- **Run target:** `docker compose up` locally. Production posture deferred.

---

## Strict Build Order

Each step ships and is usable end-to-end before the next starts. No step starts until the previous has met its exit criteria. **No AI before Step 6.** Deterministic rules first; LLMs are a second pass.

---

### Step 1 — Read-only connector dashboard (MVP)

**Goal:** Connect all 4 source types via OAuth, ingest into Postgres as raw artifacts, render per-source lists in the dashboard. No graph, no AI, no drift detection. Just proof that ingestion works.

**Deliverable:**
- FastAPI app with health, `/auth/{provider}/start` and `/auth/{provider}/callback` flows
- Connectors (each in `/api/connectors/{slack,jira,google,microsoft}/`):
  - **Slack** — OAuth bot install in a single test workspace; subscribe to Events API (message.channels, message.groups for allowlisted private channels); store messages + threads + reactions
  - **Jira** — 3LO OAuth; pull issues + comments + status transitions; subscribe to webhooks
  - **Gmail + Google Drive/Docs** — OAuth (request restricted scopes from day one but use test accounts that bypass verification); ingest emails matching configured labels; ingest Drive change feed for a configured folder
  - **Confluence** *(or skip if time-boxed; Drive can cover docs for v0)* — OAuth 3LO; pull pages + comments
- Postgres tables: `raw_artifacts(id, source, external_id, kind, payload jsonb, fetched_at, content_hash, version)` with `(source, external_id, version)` unique
- Workers: per-source backfill job + per-source delta job (cron via Arq)
- Next.js dashboard: per-source feed view, filter by project, search by content. **Three monitoring guardrails in the UI from day one:** no per-user activity views, no "who's responsive," no leaderboards.

**Out of scope:** multi-tenant, the operational graph, claims, drift, AI, propagation, real auth, real customer onboarding.

**Effort:** 2–3 weeks for a single dev.

**Exit criteria:**
1. All 4 connectors successfully ingest into Postgres against test workspaces.
2. Dashboard renders the latest 100 items per source for at least one project, with search and filter.
3. Backfill + delta workers run on a schedule; re-running them is idempotent (no duplicate rows).
4. Webhook payloads are persisted before processing; processing is retryable.
5. Manual gut-check: a real change in Slack/Jira/Doc appears in the dashboard within 60 seconds.

---

### Step 2 — Operational graph normalization

**Goal:** Map raw artifacts into a normalized graph: `Person`, `Team`, `Project`, `Artifact`, `Mention`, `Dependency`. No claims or drift yet — just the topology that everything downstream rides on.

**Deliverable:**
- New tables: `persons`, `teams`, `team_members`, `projects`, `artifacts`, `artifact_mentions`, `dependencies`. All have `tenant_id` even though local-MVP has 1 tenant.
- Identity resolution: same `Person` across Slack user, Jira user, Google account, email-from address. Heuristics: primary email > display name > manual override. Surface unresolved identities in a "needs merging" admin view.
- `Project` is user-curated for MVP: user creates a project, assigns Slack channels, Jira projects/epics, Drive folders, Confluence spaces, Gmail labels.
- Artifact normalizer (`/api/graph/normalizers/{source}.py`): take a `raw_artifact` row, emit zero-or-more `Artifact` rows + `Mention` rows. Pure functions; testable.
- Re-normalization job: triggered on raw_artifact insert; re-runnable for backfill on schema change.

**Effort:** 2 weeks.

**Exit criteria:**
1. Every raw artifact has a corresponding normalized `Artifact` row (or an explicit `skipped` reason).
2. ≥90% of Slack/Jira/email mentions are resolved to a `Person` row (rest flagged).
3. Graph queries answer: "which artifacts mention person X in the last 7 days," "which artifacts belong to project Y."
4. Re-running normalization on the full corpus is idempotent and completes within a fixed time budget.

---

### Step 3 — Claims & evidence extraction (deterministic first)

**Goal:** Pull structured **claims** out of artifacts with full evidence lineage. Deterministic regex/parser pass only — LLMs land in Step 6.

**Deliverable:**
- New table: `claims(id, project_id, kind, key, value, status, confidence, source_artifact_id, source_anchor, extracted_at, extractor_version)`. `kind ∈ {date, owner, scope, status, decision, dependency}`. `source_anchor` is a JSONB pointer back to the exact span (e.g. `{message_id, char_start, char_end}`).
- Extractors in `/api/claims/extractors/`:
  - **Dates** — chrono-style parsing of "launch date," "ship by," "deadline" patterns in Jira fields, doc text, Slack messages
  - **Owners** — `@mentions`, "X is on this," assignee fields, "owner: X" patterns
  - **Status** — Jira status transitions, "blocked," "at risk," "on track"
  - **Decisions / scope changes** — limited regex over "we agreed," "decision:", "we're cutting," "moving X to Y" patterns
- `claim_views` materialized for fast drift queries
- Dashboard surface: per-project "claims feed" with source link + verbatim evidence span

**Effort:** 2–3 weeks.

**Exit criteria:**
1. For the test project, ≥80% of explicit Jira-field dates and Slack-message dates are extracted as claims.
2. Every claim links to a source artifact AND a specific source anchor (no orphan claims).
3. Re-running extraction is idempotent (no duplicates) and increments `extractor_version` so downstream can detect re-extraction.
4. A manual review of 50 randomly-sampled claims shows ≥85% precision on each `kind`.

---

### Step 4 — Drift / conflict detection

**Goal:** Surface when claims about the same thing conflict across sources.

**Deliverable:**
- `claim_groups(id, project_id, kind, key)` — groups claims that describe the same logical fact (e.g. "Project Atlas launch date"). Grouping rule: same `(project, kind, key)`; `key` is derived per-`kind` (for `date`, the key is the date-subject like "launch"; for `owner`, the role; etc.).
- Drift rule engine in `/api/drift/rules/`:
  - **R-DATE-1:** more than one distinct `value` in a `claim_group` of kind `date` within the same project → conflict
  - **R-DATE-2:** newest source claim differs from any claim referenced in artifacts updated within the last N days → stale
  - **R-DECISION-1:** decision claim in a transcript/DM has no matching claim in a "doc-of-record" artifact within 48h → unrecorded
  - **R-OWNER-1:** Jira assignee changed; no matching mention in Slack/email in the next 24h → unannounced
- Drift findings table: `findings(id, rule_id, claim_group_id, severity, evidence_artifact_ids, status, opened_at, closed_at)`
- Dashboard: per-project "drift inbox" with open/closed findings; click-through to evidence
- **Strict UX rule:** findings name **artifacts and teams**, never individuals. "QA team has no acknowledgment in #qa-eng" not "Samir didn't respond."

**Effort:** 2 weeks.

**Exit criteria:**
1. Seeded contradiction (June 3 → June 10 across Jira/deck/Slack) is detected by R-DATE-1 within 60 seconds of the change.
2. Each finding has at minimum 2 source artifacts as evidence + a one-sentence human-readable description.
3. Findings auto-close when the underlying contradiction is resolved (e.g. deck updated to June 10).
4. A 1-week false-positive review shows ≥80% precision on the active rules; lower-precision rules are disabled or gated behind a "preview" flag.

---

### Step 5 — Propagation & acknowledgment

**Goal:** When a claim changes, identify affected people/teams via the graph and request acknowledgment in-app + via Slack DM/email. Track unack'd state.

**Deliverable:**
- `change_events(id, claim_group_id, before_claim_id, after_claim_id, detected_at)` — every claim change creates one
- "Affected" resolver: given a change event, return `{teams: [...], persons: [...]}` based on graph edges (channel membership, Jira watchers, doc viewers, prior mentions). Tunable per-project.
- `acknowledgments(id, change_event_id, subject_kind, subject_id, status, acknowledged_at, channel)` — one row per (event, team-or-person)
- Notification dispatcher: in-app inbox + Slack DM (using the customer-installed app — does not violate ToS) + email digest
- Ack UX: a single click in Slack ("acknowledge") or in-app, with evidence visible. **No "responsiveness" metric anywhere.**
- Dashboard surface: per-finding "Affected: 3 teams (2 acknowledged)" with breakdown

**Effort:** 2 weeks.

**Exit criteria:**
1. A simulated date-change generates an event, resolves to N affected teams, dispatches acknowledgments, and updates state correctly when a user clicks "ack."
2. Unacknowledged-state never references named individuals in any user-visible surface.
3. Ack records have evidence lineage: which finding, which claims, which artifacts, when sent, when acked.
4. Re-running propagation does not duplicate notifications (idempotent on `(change_event_id, subject)`).

---

### Step 6 — AI alignment briefs (first LLM step)

**Goal:** Generate per-persona, per-meeting briefs grounded **only** in claims/evidence already in the graph. No free-floating summarization.

**Deliverable:**
- `briefs(id, project_id, audience_persona, generated_at, content jsonb, model, prompt_version, source_claim_ids)` — every brief stores the exact claims it cites
- Brief generator pipeline:
  1. **Retrieve** open findings, recent change events, unacknowledged claims for the persona's team/project (deterministic — no LLM)
  2. **Compose** a structured input package (a JSON dossier of claims + evidence snippets)
  3. **Generate** prose using Claude with a strict system prompt forbidding any claim not in the input; output is JSON with `bullets[]: {text, claim_ids[]}`
  4. **Verify** that every `claim_id` cited exists; reject and regenerate if not
- UI: brief preview before send; "every sentence has a source link" presentation
- Audit log: every brief view recorded `(brief_id, viewer_id, viewed_at)`
- Hard-coded language defaults: "no recorded acknowledgment from QA team" — never "QA did not respond"

**Effort:** 2–3 weeks.

**Exit criteria:**
1. A generated brief never references a claim that isn't in the source dossier (programmatic check — 0 hallucinations on a 50-brief sample).
2. Every bullet in the brief is click-throughable to the source artifact + verbatim span.
3. Briefs render for at least 3 distinct personas (Eng Manager, QA Lead, Security Lead) for a sample project, and the persona variation is meaningful (not the same brief with names swapped).
4. The brief generator runs against the seeded contradiction and correctly flags it for each persona who needs to know.

---

### Step 7 — Forecasting & risk model

**Goal:** Pattern detection on unresolved drift → predicted operational risk.

**Deliverable:**
- `risk_signals(id, project_id, kind, score, contributing_findings, computed_at)` — daily roll-up
- Signals (deterministic first):
  - Open findings older than N days
  - Acknowledgment rate per team trending down
  - Number of unrecorded-decision findings in last 7/14 days
  - Days since last graph update from key artifacts (e.g. runbook stale)
- Dashboard: per-project "risk over time" chart, ranked open findings
- **No individual-level risk score, ever.** Project- and team-level only.

**Effort:** 1–2 weeks.

**Exit criteria:**
1. Risk signals compute daily without manual intervention.
2. At least one risk signal correlates visibly with the seeded contradiction journey (signal rises when ack rate stalls; falls when resolved).
3. No risk signal is computed at the individual level — verified by inspection of signal definitions.

---

## Cross-cutting Guardrails (apply to every step)

These are not optional polish — they are how husn.io avoids becoming surveillance software, and they are baked into code review and the audit hook (see below).

- **No individual responsiveness metrics anywhere.** Not in the UI, not in logs, not in admin tools.
- **Every claim and brief is evidence-linked.** No claim without a source artifact + anchor. No brief sentence without a claim id.
- **Anti-monitoring language defaults.** "No recorded acknowledgment from team X" not "X did not respond." Lint rules / fixtures enforce this in tests.
- **Re-runnable everything.** Backfill, normalization, extraction, drift, briefs — all idempotent on natural keys.
- **No LLM before Step 6.** Deterministic rules build the substrate of trust.
- **Privacy-by-default channel/folder allowlists.** Even in local MVP, the user must opt channels in. No "ingest everything you see."

---

## Verification (end-to-end)

The full system is verifiable against a **seeded contradiction** scenario:

1. Create a project "Project Atlas" with linked Slack channel, Jira project, Drive folder.
2. Seed Round 0 — everything aligns on June 3.
3. Round 1: change launch date to June 10 in Jira.
4. **Expected:** Step 4 fires R-DATE-1 within 60s; Step 5 dispatches acks to QA + Security teams; Step 6 brief reflects the change with evidence; Step 7 risk signal rises.
5. Round 2: update Drive doc to June 10. Expected: finding auto-closes; ack rate ticks up; risk signal falls.
6. Manually confirm no individual is named in any surface during the entire scenario.

If all six pass, husn.io's MVP is functioning end-to-end.

---

## What is deliberately NOT in this plan

- **Multi-tenancy** — local MVP only
- **SSO / SAML / SCIM** — required before first customer, not now
- **CASA + M365 Certification** — required before first paying customer (3–6 month timeline; budget separately)
- **SOC 2 Type II** — required before mid-market enterprise; ~6 months ramp on Drata/Vanta
- **Marketplace approval (Slack, Atlassian)** — pursue once architecture stabilises
- **CC'd shadow inbox** — killed per legal/DLP findings
- **EU AI Act high-risk conformity work** — by deliberately staying out of individual scoring, we aim to avoid Annex III; revisit before EU GTM
- **Forecasting beyond rule-based** — ML/learned risk models come after we have a corpus of resolved findings

---

## Audit hook (separate from this build)

A `PostToolUse` hook in `.claude/settings.json` will run after every Write/Edit and spawn a one-shot Claude review against `knowledge.md` + this `plan.md` + the changed file. Configured separately from this plan. See session notes.
