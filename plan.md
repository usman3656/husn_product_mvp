# husn.io — Implementation Plan

> **Read `knowledge.md` first.** Three findings reshape the architecture before line 1 of code: (1) Slack ToS forbids centralized bulk pull → per-workspace install pattern, (2) CC'd shadow inbox is dead → OAuth-only for email, (3) anti-monitoring framing is product structure, not polish.

> **Plan-pivot note (2026-05-24).** Original Steps 4-5-6-7 were a strict deterministic-first ladder ("no LLM before Step 6"). After shipping the Step 4 deterministic baseline (`R-DATE-1`) we observed that the rest of Steps 4-5-7 (auto-close, family-key tuning, propagation routing, separate forecasting model) are all logic the LLM agent will subsume.

> **Plan-pivot note v2 (2026-05-24).** Locked in three load-bearing commitments after a 7-parallel-critic pass: event-sourced + materialized views over query-time RAG; LLM-as-typewriter with NLI gating; tiered learning, default deterministic. See `knowledge.md` §11.

> **Plan-pivot note v3 (2026-06-07).** The frontend was repositioned end-to-end as the **organizational intelligence layer**. Three architectural commitments on the surface side, now load-bearing:
>
> - **Briefing IS the product.** The homepage answers "what needs attention today?" in six named sections ranked by consequence. Most Consequential Issue dominates. No metric cards. No dashboard widgets. No notification feed.
> - **Organization IS the digital twin.** A distinct surface that answers "how does this organization work?" via Workstreams + People × Workstreams matrix + Decision network. Strategically separated from Briefing so the two never compete.
> - **Reach Out For Me is a primary affordance.** Wherever Husn surfaces uncertainty, one-click outreach (who likely has the answer + why + draft message + send).
>
> See `## Frontend product surface` near the end.

> **Status snapshot (2026-06-10).** Steps 1, 2, 3, 4, 6 (v2), 6-chat all shipped. Wave 0 deploy is live. Wave 1 Stage 1 (v2 agent + drift framework expansion + frontend redesign) is shipped. Next: Wave 1 Stage 2 — LLM resilience + tenancy + auth + billing.

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

### Step 4 — Drift / conflict detection (deterministic, generalised)

> **Status (2026-06-07): shipped — table-driven rule framework + three rules.**
> Reversed the original "skip the rest of Step 4" pivot in Wave 1 Stage 1, with a different design: instead of hand-coding each rule, we built a `DriftRule` Protocol (`husn/drift/rules/base.py`) and table-registered rules. R-DATE-1 was already live; R-OWNER-1 + R-STATUS-1 now ship alongside as protocol implementations.

**What's live today:**
- `claim_groups(project_id, kind, key)` with family-key mapping (`launch`/`ship`/`release`/`go-live`/`cutover`/`target` → `release`; `deadline`/`due`/`target` ↔ `deadline` separately).
- **`DriftRule` Protocol** — `rule_id`, `applies_to_kind`, `severity`, `summary_template`, `detects()`, `build_summary()`. `ALL_RULES` registry in `husn/drift/rules/__init__.py`; evaluator iterates table-driven.
- **R-DATE-1** (severity high) — ≥2 distinct `value_norm` in a date-claim-group with confidence ≥ 0.5.
- **R-OWNER-1** (severity medium) — ≥2 distinct owner candidates in an owner-claim-group.
- **R-STATUS-1** (severity high) — worst-{at_risk, blocked, delayed} vs best-{on_track, complete} within 7 days.
- One finding per `(rule_id, claim_group_id)` (partial unique index enforces this).
- `findings.details` carries `per_source` blocks so the UI shows "Slack says X / Jira says Y" side-by-side.
- Cron `evaluate_drift` runs every 30 min plus on worker startup; one commit per tick.
- UI surface: surfaced in Briefing (Most Consequential, Emerging Risks, Missing Information), Investigation case-folders, Explore (Risks / Ownership lenses), Organization Decision Network.

**New deterministic extractors (Wave 1 Stage 1):** `husn/claims/extractors/scope.py` (descope/include), `dependency.py` (Slack regex + Jira `issuelinks` "blocks"), `commitment.py` (first-person + intent verb + date phrase).

**Strict UX rule (carried into Step 6):** findings name **artifacts and teams**, never individuals.

---

### Step 5 — Propagation & acknowledgment

> **Status: subsumed into Step 6.** The agent picks who needs to know and surfaces it as a recommendation. The original idea of a deterministic affected-resolver + 1-click ack flow is deferred until we see how Step 6 performs in practice.

---

### Step 6 — AI TPM agent (brief skeleton + LLM-as-typewriter)

> **Status (2026-06-07): shipped — Wave 1 Stage 1.** Pipeline live on production. See modules:
> - `husn/agent/skeleton.py` — pure deterministic skeleton builder
> - `husn/agent/render.py` — Groq Llama 3.3 70B strict typewriter prompt + sanitiser + deterministic template fallback
> - `husn/agent/nli.py` — Anthropic Haiku JSON-mode entailment verifier (default-fail-closed)
> - `husn/agent/run_v2.py` — orchestrator with empty-skeleton skip + max 2 render retries + `agent_runs` persistence
> - Personas: TPM, Eng Manager, QA Lead, Security Lead, Ops Manager.
> - Wired through cron `run_renderer_for_all_projects` every 30 min + admin `POST /api/agent/trigger`.

**Goal:** For each project, produce per-persona briefs whose every sentence is traceable to a `source_uri` in the project graph, and whose facts are computed by deterministic queries — not by the model.

**Pipeline (the order matters):**

1. **Skeleton builder (deterministic, `husn.agent.skeleton`)** — pure function `build_skeleton(project_id, persona, viewer_id) -> Skeleton`. Pulls from the operational graph + claims + materialised views; emits structured JSON:
   ```jsonc
   {
     "viewer_id": "...",                       // identity is a hard parameter
     "persona": "qa_lead",
     "project_id": "...",
     "as_of": "2026-05-24T14:00:00Z",
     "facts": [
       {"claim_id": "...", "kind": "date", "value": "2026-06-10",
        "source_uri": "jira://...", "ts": "..."}
     ],
     "conflicts": [
       {"field": "release.date",
        "candidates": [{"value": "2026-06-03", "sources": ["doc://..."]},
                       {"value": "2026-06-10", "sources": ["jira://..."]}]}
     ],
     "changes_since_last_brief": [...],
     "blockers_for_persona": [...],
     "expected_loops_missed": [...]            // from absence detector
   }
   ```
   Scope is enforced at three layers *before* the skeleton is built: Postgres RLS on `viewer_id`, graph traversal predicates, ANN metadata predicates if vectors are consulted. The LLM never decides who the user is.

2. **Renderer (LLM-as-typewriter)** — Anthropic SDK call, ~5–10K input tokens. Strict system prompt:
   - Output is JSON: `{bullets: [{text, claim_ids[]}], conflicts_rendered: [{conflict_id, text}]}`.
   - Hard rules: (a) every bullet must cite ≥1 `claim_id` from the input skeleton; (b) no `claim_id` may appear in output that isn't in input; (c) conflicts must be *rendered as conflicts*, not picked; (d) no per-individual scoring or responsiveness language; (e) "no recorded acknowledgment from team Y" not "X did not respond."
   - Renderer model: Sonnet-class for quality. Detector/classifier sub-tasks use Haiku-class.

3. **Verifier (NLI faithfulness check)** — every output sentence is checked against its cited `claim_id`'s source span. Any sentence that fails NLI is rejected; renderer is called again (max N=2 retries). Persistent failure → fall back to a deterministic template (R-DATE-1-style structured render). **A bad brief is never shown.**

4. **Persist** — `agent_runs` row with token counts, latency, retry count, fallback flag. Briefs into `briefs`. Findings (agent-derived, e.g. unrecorded decision, stakeholder-not-looped) into the existing `findings` table with `rule_id="AGENT-FINDING-*"` and rows in `finding_evidence`.

**RAG path is separate.** Vectors and top-K retrieval do NOT participate in brief generation. They live behind a future `/chat` endpoint (ad-hoc TPM questions) where agentic retrieval + planner LLM is appropriate. Briefs are precomputed against a structured view; chat is interactive over the corpus.

**Ingest-time work that powers the skeleton** (incremental, not Step 6 itself — flagged here because briefs depend on it):
- **Topic segmentation** for flat Slack channels (small classifier, ~50ms/msg) — fires on non-threaded channel messages, emits `topic_segment_id`.
- **Deixis resolver** — only on messages classified as decision/commitment containing pronouns or vague references. Resolves "that"/"the auth flow" to artefact IDs against same-segment candidates. If ambiguous → store `ambiguous: true` + candidate list (not a guess).
- **Tenant alias dictionary** (Tier 0 learning, see Step 8) — auto-mined from Jira project renames, Slack channel renames, doc title diffs. Resolver consults this.
- **Expectation / absence detector** — scheduled job: for each (project, change_kind), derive a stakeholder graph from past comms; emit a diff event when a new artefact lands without the expected `mention` edge. Silences become first-class skeleton facts (`expected_loops_missed`).

**Schema additions:**
- `briefs(id, project_id, persona, viewer_id, skeleton jsonb, rendered jsonb, model, prompt_version, fallback_used bool, generated_at)` — `rendered.bullets[].claim_ids[]` MUST be a subset of `skeleton.facts[].claim_id`.
- `agent_runs(id, project_id, triggered_by, started_at, finished_at, status, input_token_count, output_token_count, retry_count, nli_fail_count, error)` — per-run audit log.
- `topic_segments(id, source_channel_id, started_at, ended_at, participant_ids[], entity_ids[])` — output of the segmenter.
- `deixis_resolutions(id, source_message_id, resolved_referent_id, resolver_version, confidence, ambiguous bool, candidates jsonb, source_clarification_id nullable)` — output of the resolver; `source_clarification_id` is filled when a user clarification later resolves an ambiguous case (joins to Step 7).
- `expectation_misses(id, project_id, change_event_id, expected_persons[], emitted_at, status)` — output of the absence detector.

**Triggering:**
- Cron `agent_brief` every 5 minutes per project per active persona.
- On-demand `POST /api/agent/brief?project_id=...&persona=...&viewer_id=...` from a "Re-run analysis" button.
- Webhook-driven: significant events (status change, new commitment, conflict detected) trigger an immediate skeleton-rebuild for affected personas.

**UI:**
- Drift inbox card already exists — renders agent-produced findings alongside R-DATE-1 ones (filtered by `rule_id` prefix).
- New "Briefs" card with a persona selector. Each bullet shows its source citations inline; click jumps to the artefact.
- "Re-run analysis" button shows latest `agent_runs` timestamp + token cost + whether fallback was used.
- Conflicts are rendered as side-by-side candidate cards with source links, never as prose that picks a side.

**Anti-monitoring guardrails (system prompt + post-LLM verifier):**
- Briefs scoped to the recipient's own meetings/work via `viewer_id`.
- No "responsiveness" / "leaderboard" / individual scoring surfaces.
- Findings name artefacts and teams, never individuals.
- Hard contractual posture: husn.io output cannot be used as input to performance / disciplinary decisions (carried in MSA when we get to enterprise sales).

**Exit criteria:**
1. Anthropic API key wired in `.env`; brief generation runs end-to-end on Project Atlas seeded data.
2. **Hallucination = 0** on 20-run sample (every cited `claim_id` is present in the input skeleton; verifier blocks all violations).
3. **Conflict-flattening = 0** on 20-run sample (when the skeleton carries `conflicts[]`, the rendered brief shows both candidates; renderer never picks).
4. Briefs render for ≥3 distinct personas (Eng Manager, QA Lead, Security Lead) with persona-specific framing — not the same brief with names swapped.
5. **Cost per brief ≤ $0.05** at Sonnet pricing on the test project (target: ~$0.02). Latency p95 ≤ 3s.
6. Anti-monitoring guardrails pass LLM-as-judge check across 20 runs.
7. Identity-scope test: a second `viewer_id` with different project membership produces a brief that does not leak the first viewer's facts.

---

### Step 7 — Feedback loop (clarifications + two-track writes)

> **Repurposed from old `subsumed` slot.** The feedback loop is the moat: it's where husn.io learns the language of a specific tenant over time. Without two-track discipline it's also where the product becomes wrong on purpose. See `knowledge.md` §11.D.

**Goal:** Capture user clarifications (and other explicit corrections) as first-class events, apply them to the graph immediately as facts, and gate generalisation behind quorum + reputation + conflict-of-interest rules.

**Schema additions:**
- `clarifications(id, tenant_id, ambiguous_event_id, kind, chosen_referent_id, by_user_id, ts, ui_session_id, authority_score, conflict_of_interest bool, status)` — `kind ∈ {deixis, owner, date, decision_resolves, alias_proposal}`. Authority score derived from RACI on the project at time of clarification.
- `clarification_quorum(pattern_candidate_id, clarification_id, weight)` — many-to-many; the weighted vote tally for promotion of a pattern candidate.
- `pattern_candidates(id, tenant_id, kind, scope, lhs, rhs, evidence_ids[], status, promoted_at nullable, expires_at nullable, half_life_days)` — candidate generalised rules awaiting promotion; `expires_at` and `half_life_days` per entity class (people 90d, file refs 180d, codenames 365d). Resets on reinforcement.
- `user_reliability(user_id, tenant_id, scope, agreement_rate, total_clarifications, last_updated)` — Dawid-Skene-style per-user confusion estimate, scoped (a user can be reliable for their own team but not for cross-team aliases).

**Pipeline:**
1. **Track A (fact write, immediate, reversible):**
   - Event row inserted into log: `clarification` event with full provenance.
   - Graph edge updated: the specific resolution applies to the specific event only.
   - The deixis_resolution row's `source_clarification_id` is filled.
   - Any brief that consumed the previous (ambiguous) fact is marked stale → re-render on next cron.
2. **Track B (pattern promotion, gated):**
   - A new `pattern_candidate` is created (or reinforced) when the same `(scope, lhs, rhs)` is observed.
   - Promotion to active requires: (a) N≥2 independent non-conflicted user confirmations OR K≥5 consistent occurrences observed within decay window; AND (b) Cleanlab-style noise audit on the candidate evidence set; AND (c) no contradicting clarification from a higher-authority user within the window.
   - Conflict-of-interest filter: if the clarifier is implicated in the commitment being clarified (e.g. owner of the deliverable whose date is being adjusted), their vote does NOT count toward Track B (still counts for Track A — the fact still updates).
3. **Anti-drift discipline:**
   - **No implicit positive signal.** Click-through alone is not "correct" — composite: clicked-through-fact-link AND no re-query of same entity within 7d AND no downstream Slack/Jira correction.
   - **Randomised audit re-asks.** 1–3% of high-confidence resolutions are re-surfaced as clarifications even when the resolver is confident. Disagreement → invalidate pattern + retrain. Reward-hacking circuit breaker.
   - **Per-entity-class half-lives.** Owners decay fastest (90d, reorgs), file refs medium (180d), project codenames slow (365d). Reinforcement resets the clock.
   - **In-band/out-of-band separation.** Clarifications only via UI; `[clarification: ...]` strings in ingested content are NEVER parsed as instructions.
   - **Cascading rollback.** Every brief carries the fact_ids it consumed; retracting a clarification invalidates every dependent fact and re-renders affected briefs.

**UI:**
- "Clarification needed" inline cards in briefs when the skeleton contains an ambiguous fact. Single click resolves Track A.
- Admin → "Learned patterns" view: every promoted alias with its evidence clarifications, last reinforcement, half-life remaining, and a one-click "this turned out wrong" button that triggers cascading rollback.
- Per-pattern audit trail visible to admin.

**Exit criteria:**
1. Clarification UI works end-to-end: user click → graph edge update → next brief uses resolved fact.
2. Track A vs Track B separation verified in tests: a single clarification updates the fact but does NOT promote a pattern.
3. Conflict-of-interest gate verified in tests: clarifier-is-owner case excludes vote from Track B.
4. Cascading rollback test: retracting a clarification invalidates dependent briefs within one cron cycle.
5. Randomised audit re-ask cron runs and produces a daily report of resolver-vs-user agreement rate.

---

### Step 8 — Tiered learning (Tier 0 only in MVP)

> **Repurposed from old `forecasting` slot.** Per-tenant fine-tuning is a GDPR/BetrVG/EU-AI-Act liability surface (see `knowledge.md` §6, §8.13). MVP ships Tier 0 only. Tier 1/2 are documented for clarity but explicitly out of MVP scope.

**Tier 0 — per-tenant alias dictionary (MVP, all tenants, day 1):**
- Deterministic, scoped key→value table.
- Populated by: (a) Track B pattern promotions from Step 7, (b) auto-mining of Jira/Slack/Drive rename events.
- Consumed by: deixis resolver, query expansion in `/chat` retrieval, entity normaliser.
- Fully reversible; full evidence trail; per-pattern half-life.
- **Compliance posture:** standard processor terms; GDPR Art 17 erasure = drop the source clarification rows + recompute dictionary (≤1h SLO).

**Tier 1 — embedding-based few-shot at inference (deferred; ~100+ labels per scope):**
- Clarifications and their resolutions stored as labelled examples per tenant.
- At resolver inference time, retrieve top-K nearest examples; pass as in-context exemplars to a Haiku-class call.
- No model weights are updated. No fine-tuning.
- **Compliance posture:** standard processor terms; erasure = drop the labelled examples.

**Tier 2 — per-tenant LoRA adapter (deferred; opt-in only; ~10K+ labels):**
- Shared base small model + per-tenant LoRA adapter, hot-swapped on the inference fleet.
- Training corpus: rolling N-day window of labelled clarifications (not the entire history — bounded retention is the Art 17 procedure).
- Mandatory pre-train: Cleanlab confident-learning noise audit; quarantine outliers.
- Mandatory pre-deploy: frozen per-tenant regression suite + base-behaviour canary; orthogonal-projection LoRA to bound interference.
- Mandatory: ZDR-only inference path; per-tenant API key; circuit-breaker refuses any endpoint missing ZDR attestation.
- **Compliance posture:** DPIA, opt-in, BetrVG works agreement template if German tenant, AI Act Annex III conformity work, documented Art 17 procedure (drop user's clarifications + rebuild on next scheduled retrain, 24–72h SLO).

**MVP scope:** Tier 0 only. Tier 1 considered once any tenant has >100 labelled clarifications per scope. Tier 2 is a paid-tier feature requiring DPIA — not pursued until at least one enterprise customer has signed a contract requiring it.

**Exit criteria (Tier 0 only):**
1. Pattern promotions from Step 7 land in the dictionary and the resolver consults it on next invocation.
2. Auto-mined renames (Jira project name change, Slack channel rename, doc title diff) appear in the dictionary within one cron cycle.
3. Admin can view, edit, expire, or delete any dictionary entry with full evidence trail.
4. Dictionary state is fully reproducible from the event log + clarifications table (no baked state).

---

## Frontend product surface (shipped Wave 1 Stage 1, 2026-06-07)

Repositioned from "dashboard / integration platform" to **organizational intelligence layer**. Six destinations under the side-nav. Detailed description lives in `PROGRESS.md` "Frontend surface"; design rationale here:

### Briefing — the homepage IS the product
Six sections in order, ranked by **consequence**, never recency: Organizational Pulse (live rings: continuous comet orbit + breath + count-up + sparkline + click-to-breakdown) → Most Consequential (dominating editorial hero, confidence bar, Potential Impact / People Closest, Reach Out For Me as the primary action) → Emerging Risks + Missing Information (parallel columns) → Recommended Actions (verb-led to-dos) → Active Projects.

### Organization — the Organizational Digital Twin
A distinct surface, never overlapping the Briefing. Five sections: Workstreams (editorial blocks) → Organizational map (People × Workstreams matrix: calm grid, intensity-graded dots, hover/click reveals the relationship, no spaghetti) → People in the picture (context cards) → Decision network (R-STATUS-1 + R-DEP + agent findings framed as decisions-in-motion with stacked-avatar influencers) → Sources of truth (quiet chip strip). Answers "**how does this organization work?**" — never "what needs attention today" (that's Briefing).

### Ask Husn — document-style Q&A
Conclusion + Evidence + next-step structure per answer. Not ChatGPT-with-citations. Suggested questions on empty state. `/chat` 301-redirects to `/ask`.

### Investigations — case folder per finding
Hero + side-by-side evidence + timeline + sticky action rail with Reach Out For Me.

### Explore — by understanding, not issue type
Seven lenses: Projects · Teams · Risks · Ownership · Dependencies · Decisions · Resolved.

### Connections — workspace plumbing
Restyled, demoted. Each connection has a Show files toggle that lazy-loads the per-file list with green = Read (raw + normalized) / amber = Fetched.

### Cross-cutting: Reach Out For Me
Surfaced wherever Husn shows uncertainty. Tinted predicted/purple — the semantic colour for derived information. Opens a modal with: who likely has the answer + why + draft message + Send via Slack/Email (Copy fallback).

### Theme
Light / Auto / Dark in side-nav. `data-theme` on `<html>`, no-FOUC inline boot script, 200 ms colour transitions, `color-scheme` hint per choice.

### Semantic colour vocabulary
- Green = aligned
- Amber = uncertain
- Red = active conflict
- Purple = predicted
- Blue = understood

Used only where meaning is encoded; never decorative.

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

The full system is verifiable against a **seeded contradiction + clarification + identity-scope** scenario:

1. Create a project "Project Atlas" with linked Slack channel, Jira project, Drive folder. Three personas (Eng Manager, QA Lead, Security Lead) with distinct `viewer_id`s.
2. Seed Round 0 — everything aligns on June 3.
3. **Round 1 (drift):** change launch date to June 10 in Jira.
   **Expected:** Step 4 fires R-DATE-1 within 60s. Step 6 skeleton picks up the conflict; renderer produces a brief that shows both candidates side-by-side (NOT picking one). Verifier reports `nli_fail_count=0`. Cost per brief ≤ $0.05.
4. **Round 2 (reconciliation):** update Drive doc to June 10.
   **Expected:** conflict closes; next brief reflects single value; cascading rollback updates dependent rows.
5. **Round 3 (deixis + clarification):** seed a Slack thread where someone says "let's go with that approach" between two competing proposals.
   **Expected:** deixis resolver marks `ambiguous: true` with candidate list. Brief surfaces a "clarification needed" item. User clicks → Track A fact updates immediately; Track B does NOT auto-promote a pattern (only one confirmation).
6. **Round 4 (silence):** merge a change in #ios that historically would have triggered a notification in #backend; do not send it.
   **Expected:** absence detector emits `expected_loops_missed`; next backend-persona brief includes the missed-loop line item.
7. **Round 5 (identity scope):** second `viewer_id` with different project membership requests a brief.
   **Expected:** their brief contains no facts from projects they don't own; RLS test passes.
8. **Anti-monitoring guardrail check:** manually confirm no individual is named in any surface during the entire scenario; LLM-as-judge on 20-run sample reports zero per-individual responsiveness language.

If all eight pass, husn.io's MVP is functioning end-to-end.

---

## What is deliberately NOT in this plan

- **Multi-tenancy** — local MVP only (but `tenant_id` is on every table from day one so the cutover is mechanical)
- **SSO / SAML / SCIM** — required before first customer, not now. Identity is mocked via a local `viewer_id` in the URL for MVP — same code path that SSO will populate later.
- **CASA + M365 Certification** — required before first paying customer (3–6 month timeline; budget separately)
- **SOC 2 Type II** — required before mid-market enterprise; ~6 months ramp on Drata/Vanta
- **Marketplace approval (Slack, Atlassian)** — pursue once architecture stabilises
- **CC'd shadow inbox** — killed per legal/DLP findings
- **EU AI Act high-risk conformity work** — by deliberately staying out of individual scoring, we aim to avoid Annex III; revisit before EU GTM
- **Forecasting beyond rule-based** — ML/learned risk models come after we have a corpus of resolved findings
- **RAG for briefs** — explicitly out. RAG only powers the future `/chat` surface; briefs are precomputed against a structured view.
- **Per-tenant LoRA fine-tuning (Tier 2)** — out until a paying enterprise customer requires it AND DPIA + BetrVG agreement template are signed
- **Cross-tenant learning of any kind** — never. Per-tenant isolation is sacred; no shared dictionaries, no shared classifiers trained on customer data, no shared LoRA bases.

---

## Audit hook (separate from this build)

A `PostToolUse` hook in `.claude/settings.json` will run after every Write/Edit and spawn a one-shot Claude review against `knowledge.md` + this `plan.md` + the changed file. Configured separately from this plan. See session notes.
