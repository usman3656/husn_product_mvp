# husn.io — PROGRESS

> Living state log. Read this file first at the start of every Claude session to know where we are. Updated after every meaningful code change and every commit.

---

## TL;DR — where we are right now

| Field | Value |
|---|---|
| Last commit on `main` | `b96c1a9` — Step 6 v1 checkpoint + Step 6 v2 architecture docs + chat with RAG |
| Current step in flight | **Step 6 v2 — AI TPM agent (skeleton + LLM-as-typewriter + NLI verifier)** |
| Phase within Step 6 v2 | v1 (single-call LLM-direct-from-dossier) shipped as checkpoint; v2 rewrite is next coding step |
| **LLM backend live** | Groq (`llama-3.3-70b-versatile`, free tier, 6K TPM). API key in `.env`. Ollama qwen2.5:7b also available locally as fallback. |
| Services up? | `docker compose ps` — should show 5 containers (postgres, redis, api, worker, web) |
| Audit watcher? | `.claude/bin/audit-watcher.sh status` — should be `running` |

---

## Step status

| Step | Status | Notes |
|---|---|---|
| **1 — Connectors** | ✅ shipped (4 of 4 sources) | Jira (3LO OAuth), Slack (OAuth v2 bot install), Google (Gmail + Drive + Docs + Sheets, allowlist UI, delta sync), **Microsoft (Outlook + OneDrive incl. shared/remoteItem folders, per-folder delta sync, content extraction for .html / .csv / .txt / .docx / .xlsx)**. Per-panel disconnect buttons on all four. |
| **2 — Operational graph** | ✅ shipped | persons, person_identities, projects, project_sources, artifacts, artifact_mentions. Continuous sync via Arq cron. Email identities resolved by lowercase email address; mention writes use `ON CONFLICT DO NOTHING`. |
| **3 — Claims (deterministic)** | 🟡 partial — Slack + Jira only | 7 extractors with evidence anchors fire on Slack messages + Jira issues. Google email / doc / sheet content is normalized but **no extractors run on it yet** (would need ~3 new extractor classes; trivial work but not yet shipped). |
| **4 — Drift (deterministic)** | 🟡 partial — kept | R-DATE-1 shipped + Drift inbox UI. Remaining rules (R-DATE-2, R-DECISION-1, R-OWNER-1) + auto-close **skipped per 2026-05-24 pivot**. R-DATE-1 stays as always-on fallback. |
| **5 — Propagation** | ⛔ subsumed | Folded into Step 6. Agent will decide who needs to know. |
| **6 — AI TPM agent (brief skeleton + LLM-as-typewriter)** | 🟡 v1 shipped, v2 pending | **v1 (single-call LLM-direct-from-dossier) is live.** Produces 2 findings + 4 briefs in ~2s on Groq Llama 3.3 70B; citation validator catches hallucinated claim_ids. **v2 rewrite is next:** deterministic skeleton builder → Anthropic renderer → NLI verifier → deterministic-template fallback. See `## What's next`. |
| **6.chat — Interactive Q&A (RAG, aligned with v2)** | ✅ shipped | `/chat` page with session sidebar; client-side fetch; assistant turns cite `[claim N]` / `[artifact N]` chips; per-question RAG retrieval via Postgres ILIKE keyword search across artifacts.title+body, deduped against a recency floor. Working end-to-end against Project Atlas. |
| **7 — Feedback loop (clarifications + two-track writes)** | 📋 planned | Repurposed slot. Track A fact-writes immediate; Track B pattern promotions gated on quorum + COI + Dawid-Skene reliability. **Also bundled into Step 7: full file-type coverage** — see the dedicated row below. |
| **7.files — Full file-type coverage (read ALL formats, full content)** | 📋 planned | Today's gaps: (a) **.pptx** (PowerPoint) — both OneDrive and Google Slides — needs `python-pptx` + Slides API path; (b) **PDF** — needs `pypdf` or similar, applies to OneDrive PDFs and Google Drive PDFs; (c) **Google Sheets full content** — currently capped at 50 rows/tab × all sheets, lift to full; (d) **OneDrive .xlsx full content** — same 50-row cap, lift to full; (e) other formats encountered in real customer data (.rtf, .odt, .pages, .keynote, archived .zip). One unified `content_extractor` module callable from both Google + Microsoft backfills. |
| **8 — Tiered learning (Tier 0 dict only in MVP)** | 📋 planned | Tier 0 alias dictionary. Tier 1 (few-shot) deferred; Tier 2 (LoRA) opt-in / DPIA-only, out of MVP. |
| **Connections management** | ✅ shipped | `/connections` page lists every source connection with token health, scope count, artifact count, last-sync time. Disconnect wipes the token + allowlist but keeps historical data. |
| **Audit watcher** | ✅ shipped | Host-side Python daemon polls the project tree every 4s and runs `.claude/audit.sh` on changes. Survives terminal close, not reboot. |

---

## Pivot log (newest first)

### 2026-05-24 (v2) — Architecture deepening: brief skeleton + LLM-as-typewriter + two-track feedback

**Decision.** Before any Step 6 code lands, locked in three load-bearing architecture commitments after a 7-agent parallel critique pass (cost / recall / alternatives / correctness / feedback-loop / privacy / adversarial). Repurposed Steps 7 and 8 from `subsumed` to cover feedback-loop and tiered-learning.

**Three commitments:**
1. **Event-sourced + materialized views, not query-time RAG.** Briefs are precomputed against a structured per-(project, persona) view. RAG is reserved for the future `/chat` surface only.
2. **LLM-as-typewriter, never as source-of-truth.** Briefs render from a deterministic structured "brief skeleton" (facts, conflicts, changes, blockers, missed-loops). NLI post-check rejects any rendered sentence whose claim isn't in the skeleton.
3. **Tiered learning, default deterministic.** Tier 0 (alias dict) only in MVP. Tier 1 (few-shot) deferred. Tier 2 (per-tenant LoRA) opt-in / DPIA-gated.

**Why.** Naive RAG fails this product on cost (~$3,300/tenant/mo vs ~$300–600 target), recall (top-K can't retrieve silences or deixis), correctness (1–10% hallucination floor permanently destroys TPM trust), and conflict-flattening (RAG smooths disagreement into a guess, but coordination *is* noticing disagreement). Per-tenant fine-tuning is a GDPR Art 17 + BetrVG + EU AI Act Annex III liability surface, not a feature.

**Schema additions queued for Step 6:** `briefs`, `agent_runs`, `topic_segments`, `deixis_resolutions`, `expectation_misses`.

**Schema additions queued for Step 7:** `clarifications`, `clarification_quorum`, `pattern_candidates`, `user_reliability`.

**See** `plan.md` Steps 6, 7, 8 and `knowledge.md` §11 for the full design.

### 2026-05-24 — Skip remaining deterministic rules; bring Step 6 (LLM agent) forward

**Decision.** Halt further deterministic rules (R-DATE-2, R-DECISION-1, R-OWNER-1, family-key tuning, auto-close logic) and skip Step 5 (propagation) and Step 7 (forecasting) as separate steps. Collapse into a single agent-driven Step 6.

**Why.** Chat messages can't be retroactively edited, so deterministic auto-close is brittle. Binding-vs-nonbinding language requires reading the conversation. Cancelled milestones don't get delete events. The LLM agent reads the full context and makes these calls; hand-coding more rules is throwaway effort.

**What's kept as substrate (not wasted):**
- Connectors, raw_artifacts, operational graph, claims table with evidence anchors, claim_groups schema, findings schema, finding_evidence schema, Drift inbox UI, R-DATE-1 (as fallback).

**What's dropped:** R-DATE-2, R-DECISION-1, R-OWNER-1, auto-close-on-reconvergence, family-key tuning, separate Step 5 propagation routing, separate Step 7 forecasting model.

**See** `plan.md` `Step 6` for the new scope.

---

## What's next (Step 6/7/8 build plan, post-architecture-pivot)

Open tasks (re-scoped to new architecture):

| # | Subject | State |
|---|---|---|
| 45 | Architecture pivot v2 — brief skeleton + LLM-as-typewriter | 🟡 in progress (this commit is the docs portion) |
| 46 | `briefs` + `agent_runs` schema (Alembic `0006_agent.py`) | pending |
| 47 | Skeleton builder (`husn.agent.skeleton.build_skeleton(project_id, persona, viewer_id) -> Skeleton`) — pure function, no LLM | pending |
| 48 | Anthropic renderer + strict system prompt + JSON-output schema | pending — needs API key |
| 49 | NLI verifier + reject-and-retry + deterministic-template fallback | pending |
| 50 | Brief persistence + cron + on-demand endpoint with `viewer_id` scope | pending |
| 51 | Dashboard: extend Drift inbox + add Briefs card with persona selector + identity-scope mock | pending |
| 52 | `topic_segments` + topic segmentation classifier (Slack flat channels) | pending — Step 6 dep |
| 53 | `deixis_resolutions` + deixis resolver (decision/commitment messages only) | pending — Step 6 dep |
| 54 | `expectation_misses` + absence detector cron | pending — Step 6 dep |
| 55 | `clarifications` + `pattern_candidates` + `user_reliability` schema (Step 7) | pending |
| 56 | Clarification UI + Track A fact-write path | pending |
| 57 | Track B promotion gate (quorum + COI + Dawid-Skene) + cascading rollback | pending |
| 58 | Tier 0 alias dictionary + auto-mining of rename events (Step 8) | pending |

(Earlier tasks 39-44 covered Step 4 ship; task 38 was Step 3 e2e verify.)

### Pending user actions

1. **Paste Anthropic API key** if we want Sonnet for the v2 renderer (recommended — better at strict skeleton-only-citation discipline than open models). Groq Llama 3.3 70B keeps working as fallback / for chat. Rotate the Groq key in chat after rotation cadence.
2. (Already chosen) Triggering pattern: **scheduled cron every 5 min per (project, persona) + on-demand "Re-run analysis" button + webhook-driven on significant events**.
3. (Already chosen) Brief output: **per-persona briefs with conflicts rendered side-by-side**. Agent findings written into existing `findings` table with `AGENT-FINDING-*` prefix.

### Next coding session order

1. **Schema** (task 46) — `briefs`, `agent_runs`, `topic_segments`, `deixis_resolutions`, `expectation_misses` in one migration. `viewer_id` on `briefs`.
2. **Skeleton builder** (task 47) — pure function returning structured JSON: `{viewer_id, persona, project_id, as_of, facts[], conflicts[], changes_since_last_brief[], blockers_for_persona[], expected_loops_missed[]}`. No LLM. Heavily tested in isolation.
3. **Renderer** (task 48) — Anthropic SDK call. System prompt forbids citing claim_ids not in skeleton; forbids picking a side on conflicts; forbids per-individual language. JSON output schema enforced.
4. **Verifier** (task 49) — NLI check on each output sentence vs its cited claim_id's source span. Reject + retry max 2. Fallback to deterministic template.
5. **Persistence + cron + on-demand + identity-scope** (task 50) — agent_runs row per run; briefs with `viewer_id`; cron per (project, persona); RLS check enforced.
6. **Dashboard** (task 51) — Briefs card with persona selector; mock `viewer_id` in URL pre-SSO; conflicts as side-by-side candidate cards.
7. **Ingest-time deps** (tasks 52-54) — topic segmentation, deixis resolver, absence detector. These power the skeleton.
8. **Feedback loop** (tasks 55-57, Step 7) — clarifications schema, UI, Track A/B, rollback.
9. **Tier 0 dictionary** (task 58, Step 8) — populated by Step 7 promotions + auto-mined renames.

---

## Running stack (local dev)

```bash
# from /Users/bawani/idea/go_big_product
docker compose ps                    # 5 containers expected
docker compose logs -f worker        # see cron firing (15s normalize, 30s drift, 5min agent once wired)
open http://localhost:3000           # dashboard: health + Operational graph + Drift inbox + Claims + Slack/Jira panels
curl http://localhost:8000/health    # {"status":"ok","version":"0.0.1"}
```

### Cron schedule (today)

| Job | Cadence | Status |
|---|---|---|
| `jira_backfill` | :00 every minute | live |
| `google_backfill` | :15 every minute | live — delta-only after first run (Gmail historyId + Drive startPageToken cursors stored on `connections.extra`) |
| `slack_backfill` | :30 every minute | live |
| `normalize_graph` | :00 :15 :30 :45 | live |
| `extract_claims` | :05 :20 :35 :50 | live (Slack + Jira only — Google not yet wired) |
| `evaluate_drift` (R-DATE-1) | :10 :40 | live |
| `agent_brief` (per project × persona, skeleton + render + verify) | every 5 min | **planned (Step 6)** |
| `topic_segment` (Slack flat channels) | on-message | **planned (Step 6 dep)** |
| `deixis_resolve` (decision/commitment messages only) | on-message | **planned (Step 6 dep)** |
| `expectation_miss` (absence detector) | every 10 min | **planned (Step 6 dep)** |
| `pattern_promote` (Track B quorum check) | every 30 min | **planned (Step 7)** |
| `audit_reask` (randomised 1–3% re-asks) | daily | **planned (Step 7)** |

### Current data snapshot (last known)

- 10 persons · 11 identities · 1 project ("All work") · 17 project_sources (3 Slack channels + 1 Jira project + 12 Gmail labels + 1 Drive folder)
- 62 normalised artifacts: 3 Jira issues + 1 Jira project + 3 Slack channels + 3 Slack users + 26 Slack messages + 12 Google docs + 8 Google sheets + 6 Google emails
- 58 artifact_mentions
- ~40 claims · 1 open finding (`R-DATE-1` release-date drift in Atlas seeded messages: 2026-06-03 vs 2026-06-10)

(Re-check with `curl http://localhost:8000/api/graph/summary` + `curl http://localhost:8000/api/findings/summary`.)

---

## Files that matter

| Doc | What it's for |
|---|---|
| `PROGRESS.md` | **this file** — read first to know where we are |
| `plan.md` | step-by-step build plan; updated when scope changes |
| `knowledge.md` | research / market / legal / risk substrate; updated when assumptions change |
| `prompt.md` | original product brief ("SyncGuard"); historical context, unchanged after Step 0 |
| `docs/jira-setup.md` | how the Jira OAuth integration was registered |
| `docs/slack-setup.md` | how the Slack OAuth integration was registered |
| `docs/google-setup.md` | how the Google OAuth client was registered + scope choice rationale |
| `docs/microsoft-setup.md` | how the Microsoft Entra app was registered + scope choice rationale |
| `original-prompt.md` | founder prompt captured verbatim + survived-vs-adapted side-by-side |
| `.claude/bin/audit-watcher.{py,sh}` | always-on host-side audit daemon |

---

## Update protocol

When Claude makes a change:
- **After a CODE commit:** update `Last commit on main` in the TL;DR table + add the commit hash and one-line summary to `## Recent activity`.
- **Doc-only commits that update PROGRESS itself are exempt** from the `Last commit` bump to avoid infinite self-reference; just append to `## Recent activity`.
- **After a scope pivot:** add a new section to `## Pivot log`.
- **After a step ships:** update `## Step status` table + add an exit-criteria note.

Keep this file under ~300 lines. Truncate `Recent activity` to last 30 entries.

---

## Recent activity (newest first)

- **2026-05-24** — Commit `b96c1a9`: Step 6 v1 checkpoint + v2 architecture docs + chat with RAG. v1 brief path is live but explicitly NOT v2-aligned; next coding step is to rewrite to skeleton + typewriter + NLI verifier. Chat surface IS v2-aligned (RAG only on `/chat`). Verified live: 2 findings + 4 briefs from Project Atlas data in 1.96s, 0 hallucinated citations. Chat answers correctly cite Google Doc "Weekly Status Notes — Atlas" after RAG retrieval pull-in.
- **2026-05-24** — Docs-only pivot v2: architecture deepening (brief skeleton + LLM-as-typewriter + two-track feedback + Tier-0-only learning). 7-agent parallel critic pass ratified. `knowledge.md` §11 added with the architecture decisions and §8 holes 12–14 added with the risks the critics surfaced. `plan.md` Step 6 fully rewritten; Steps 7 and 8 repurposed from `subsumed` slots to cover feedback-loop and tiered-learning. No code changes — Step 6 build will start from the new design.
- **2026-05-24** — Commit `50e5910`: audit-watcher daemon. Host-side Python poller (no deps), 4s interval, calls existing `.claude/audit.sh` on changed files. Started in background (`pid` in `/tmp/husn-audit-watcher.pid`). Storms capped at 5 audits/tick.
- **2026-05-24** — Commit `e5d2d39`: Google connector end-to-end. OAuth 2.0 + offline access, Gmail + Drive + Docs + Sheets pulled, allowlist UI with Drive folder TREE picker (lazy-loaded subfolder expand, multi-select at any depth), `/connections` management page with disconnect, delta sync via Gmail historyId + Drive startPageToken cursors stored on `connections.extra`. Bootstrapped against the user's `husunn.ai@gmail.com` workspace: 12 docs ("Project Atlas — Launch Plan", "QA Regression Plan", etc.), 8 sheets ("Risk Register", "Cutover Task Tracker"), 6 emails ("Cutover window approval — Atlas → June 10 GA"). Two bug fixes inline: mention dedup + ON CONFLICT, per-row rollback in normalize.
- **2026-05-24** — Plan pivot: bring Step 6 forward, skip remaining deterministic rules. `plan.md` + `knowledge.md` + this file updated. Awaiting Anthropic API key from user.
- **2026-05-24** — Commit `996b341`: Step 4 R-DATE-1 deterministic baseline (claim_groups + findings + finding_evidence schema, family-key grouper, R-DATE-1 evaluator with auto-close, Drift inbox UI). Fires live on the user's seeded Project Atlas data: "Release date drift in All work: 2026-06-03, 2026-06-10". This is the always-on fallback when the Step 6 agent is down or unavailable.
- **2026-05-23** — Commit `e4bf408`: Step 3 deterministic claims extraction (7 extractors, evidence anchors, dashboard Claims card, cron every 15s). 26 claims extracted on cold boot.
- **2026-05-23** — Commit `0e400c0`: Step 1.5 real Jira + Slack OAuth + Step 2 operational graph with continuous Arq cron sync. 27 artifacts, 22 mentions, in-sync.
- **2026-05-23** — Commit `e3644c0`: Step 1 scaffold (docker compose, FastAPI + SQLAlchemy + Alembic, Next.js dashboard, connector stubs).
- **2026-05-23** — Commit `91c8c02`: initial product brief (`prompt.md`).
