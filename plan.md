# husn.io — Implementation Plan

> **Read `knowledge.md` first.** Three findings reshape the architecture before line 1 of code: (1) Slack ToS forbids centralized bulk pull → per-workspace install pattern, (2) CC'd shadow inbox is dead → OAuth-only for email, (3) anti-monitoring framing is product structure, not polish.

> **Plan-pivot note (2026-05-24).** Original Steps 4-5-6-7 were a strict deterministic-first ladder ("no LLM before Step 6"). After shipping the Step 4 deterministic baseline (`R-DATE-1`) we observed that the rest of Steps 4-5-7 (auto-close, family-key tuning, propagation routing, separate forecasting model) are all logic the LLM agent will subsume — and chat messages can't be retroactively edited, so deterministic auto-close is inherently brittle. The pivot:
>
> - **Step 1-3 + Step 4 deterministic baseline:** kept as the *substrate* the agent reads (ingestion, operational graph, claims with evidence anchors, claim_groups, finding_evidence schema).
> - **Step 4 remaining rules (R-DATE-2, R-DECISION-1, R-OWNER-1, family-key tuning, auto-close):** **skipped** — the agent does richer judgement.
> - **Step 5 (propagation routing) + Step 7 (forecasting):** **subsumed into Step 6** — the agent decides who needs to know and surfaces forecast signals in the same loop.
> - **Step 6 (AI alignment briefs):** **brought forward and expanded** to cover findings, briefs, and recommendations in one agent.
>
> See `## Step 6 — AI TPM agent (expanded)` below for the new scope.

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

### Step 4 — Drift / conflict detection (deterministic baseline only)

> **Status (2026-05-24): partially shipped, remainder skipped per pivot.**
> Shipped: `claim_groups`, `findings`, `finding_evidence` schema + rule **R-DATE-1** + dashboard Drift inbox + family-key grouper (launch/ship/release/go-live/cutover/target → "release"). This baseline acts as the always-on fallback even if Anthropic is down.
> Skipped: R-DATE-2 (stale), R-DECISION-1 (unrecorded), R-OWNER-1 (unannounced), auto-close-on-reconvergence, deeper family-key tuning. All subsumed by Step 6 agent.
> Reason: chat messages can't be retroactively edited, so deterministic auto-close is inherently brittle; richer judgement (binding vs nonbinding, correction messages, cancelled milestones) requires reading the conversation, which is what the LLM does.

**What's live today:**
- `claim_groups(project_id, kind, key)` with family-key mapping (`launch`/`ship`/`release`/`go-live`/`cutover`/`target` → `release`; `deadline`/`due`/`target` ↔ `deadline` separately).
- R-DATE-1 fires when ≥2 distinct `value_norm` exist in a date-claim-group with confidence ≥ 0.5. Opens one finding per `(rule_id, claim_group_id)` (partial unique index enforces this).
- `findings.details` carries `per_source` blocks so the UI shows "Slack says X / Jira says Y" side-by-side.
- Cron `evaluate_drift` runs at `:10` and `:40` every minute, plus on worker startup.
- UI surface: red "Drift inbox" card on dashboard with side-by-side evidence; "in sync" green badge when zero open.

**Strict UX rule (carried into Step 6):** findings name **artifacts and teams**, never individuals.

---

### Step 5 — Propagation & acknowledgment

> **Status: subsumed into Step 6.** The agent picks who needs to know and surfaces it as a recommendation. The original idea of a deterministic affected-resolver + 1-click ack flow is deferred until we see how Step 6 performs in practice.

---

### Step 6 — AI TPM agent (expanded)

> **Brought forward; expanded scope.** Replaces remaining Step 4 rules, Step 5, and Step 7. This is now the centerpiece of the product.

**Goal:** A Claude-driven loop that reads the operational graph + claims + raw artifacts and produces, for each project:
1. **Findings** — richer than R-DATE-1. Distinguishes binding commitments from nonbinding chat. Reads correction messages. Accounts for cancelled milestones. Writes into the existing `findings` table with `rule_id="AGENT-FINDING-{kind}"`.
2. **Per-persona pre-meeting briefs** — the canonical husn.io demo output. Written into a new `briefs` table.
3. **Recommendations** — "ping Security about the new dataflow", "this assignee change wasn't announced" — surfaced inline with findings.

**Schema additions:**
- `briefs(id, project_id, persona, content jsonb, model, prompt_version, generated_at)` — `content.bullets[].claim_ids[]` cite the exact claims each bullet rests on.
- `agent_runs(id, project_id, triggered_by, started_at, finished_at, status, input_token_count, output_token_count, error)` — per-run audit log.

**Pipeline:**
1. **Retrieve** (deterministic, in `husn.agent.context`): claims by group, recent artifacts in time order, identity graph for the project, current open findings.
2. **Compose** a structured dossier (JSON) keyed on `claim_id` / `artifact_id`.
3. **Generate** via Anthropic SDK with a strict system prompt:
   - Output is JSON: `{findings: [{rule_id, summary, claim_ids, severity}], briefs: [{persona, bullets: [{text, claim_ids}]}], recommendations: [...]}`.
   - System prompt forbids: (a) any claim/citation not in the input dossier, (b) any per-individual scoring or responsiveness language, (c) the "X did not respond" framing (must use "no recorded acknowledgment from team Y").
4. **Verify** post-LLM: every cited `claim_id` exists in the input; reject and regenerate (or fall back to R-DATE-1 only) if not.
5. **Persist** findings into the existing `findings` table; persist briefs into `briefs`; record evidence rows in `finding_evidence`.

**Triggering:**
- Cron `agent_analyze` every 5 minutes per project.
- On-demand `POST /api/agent/run?project_id=...` from a "Re-run analysis" button on the dashboard.

**UI:**
- Drift inbox card already exists — it'll render agent-produced findings alongside R-DATE-1 ones (filtered by `rule_id` prefix in a tag).
- New "Briefs" card with a persona selector and the per-bullet click-through to the source claim.
- "Re-run analysis" button with the latest agent_run timestamp + token cost.

**Anti-monitoring guardrails (baked into the prompt + verified post-LLM):**
- Briefs are scoped to the recipient's own meetings/work.
- No "responsiveness" / "leaderboard" / individual scoring surfaces.
- Findings name artifacts and teams, never individuals.
- Hard contractual posture: husn.io output cannot be used as input to performance / disciplinary decisions (carried in MSA when we get to enterprise sales).

**Exit criteria:**
1. Anthropic API key wired in `.env`; agent runs successfully end-to-end on the Project Atlas seeded data.
2. Programmatic check: agent never cites a `claim_id` that isn't in the input dossier (0 hallucinations on a 20-run sample).
3. Briefs render for at least 3 distinct personas (Eng Manager, QA Lead, Security Lead) with persona-specific framing — not the same brief with names swapped.
4. Agent run cost + latency per project logged; cron runs without manual intervention; on-demand button works.
5. Anti-monitoring guardrails pass an LLM-as-judge check on output: no per-individual responsiveness language detected across a 20-run sample.

---

### Step 7 — Forecasting & risk

> **Status: subsumed into Step 6.** The agent surfaces forecast signals (e.g. "this pattern of unrecorded decisions historically precedes launch slip") in the same recommendations stream. A separate ML risk model is deferred until we have a corpus of resolved findings to learn from.

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
