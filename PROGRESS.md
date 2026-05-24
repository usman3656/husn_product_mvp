# husn.io — PROGRESS

> Living state log. Read this file first at the start of every Claude session to know where we are. Updated after every meaningful code change and every commit.

---

## TL;DR — where we are right now

| Field | Value |
|---|---|
| Last commit on `main` | `996b341` — Step 4 R-DATE-1 deterministic baseline |
| Current step in flight | **Step 6 — AI TPM agent (brought forward, expanded)** |
| Phase within Step 6 | Re-scoping + docs (this commit). LLM not yet wired. |
| **Blocked on user** | Anthropic API key — paste `sk-ant-api03-...` here and I'll save it to `.env` |
| Services up? | `docker compose ps` — should show 5 containers (postgres, redis, api, worker, web) |

---

## Step status

| Step | Status | Notes |
|---|---|---|
| **1 — Connectors** | ✅ shipped | Jira (3LO OAuth) + Slack (OAuth v2 bot install). Google + Microsoft deferred at user's request. |
| **2 — Operational graph** | ✅ shipped | persons, person_identities, projects, project_sources, artifacts, artifact_mentions. Continuous sync via Arq cron. |
| **3 — Claims (deterministic)** | ✅ shipped | claims table + 7 extractors (owner, status, date, decision/scope) with evidence anchors. Cron every 15s at :05/:20/:35/:50. |
| **4 — Drift (deterministic)** | 🟡 partial — kept | R-DATE-1 shipped + Drift inbox UI. Remaining rules (R-DATE-2, R-DECISION-1, R-OWNER-1) + auto-close **skipped per 2026-05-24 pivot**. R-DATE-1 stays as always-on fallback. |
| **5 — Propagation** | ⛔ subsumed | Folded into Step 6. Agent will decide who needs to know. |
| **6 — AI TPM agent** | 🚧 starting | Brought forward + expanded to cover findings + briefs + recommendations. See `## What's next`. |
| **7 — Forecasting** | ⛔ subsumed | Folded into Step 6 recommendations stream. |

---

## Pivot log (newest first)

### 2026-05-24 — Skip remaining deterministic rules; bring Step 6 (LLM agent) forward

**Decision.** Halt further deterministic rules (R-DATE-2, R-DECISION-1, R-OWNER-1, family-key tuning, auto-close logic) and skip Step 5 (propagation) and Step 7 (forecasting) as separate steps. Collapse into a single agent-driven Step 6.

**Why.** Chat messages can't be retroactively edited, so deterministic auto-close is brittle. Binding-vs-nonbinding language requires reading the conversation. Cancelled milestones don't get delete events. The LLM agent reads the full context and makes these calls; hand-coding more rules is throwaway effort.

**What's kept as substrate (not wasted):**
- Connectors, raw_artifacts, operational graph, claims table with evidence anchors, claim_groups schema, findings schema, finding_evidence schema, Drift inbox UI, R-DATE-1 (as fallback).

**What's dropped:** R-DATE-2, R-DECISION-1, R-OWNER-1, auto-close-on-reconvergence, family-key tuning, separate Step 5 propagation routing, separate Step 7 forecasting model.

**See** `plan.md` `Step 6` for the new scope.

---

## What's next (Step 6 build plan)

Open tasks (set up but not yet started):

| # | Subject | State |
|---|---|---|
| 45 | Re-scope: skip remaining deterministic rules; plan agent step | 🟡 in progress (this commit covers the docs portion) |
| 46 | briefs schema + migration | pending |
| 47 | Agent context retriever (per project) | pending |
| 48 | Claude client + prompt + JSON-output guard | pending |
| 49 | Agent loop: persist findings + briefs | pending |

(Earlier tasks 39-44 covered Step 4 ship; task 38 was Step 3 e2e verify.)

### Pending user actions

1. **Paste Anthropic API key** — `sk-ant-api03-...`. I'll save to `.env` (gitignored). Rotate after we're done since chat logs are a risk.
2. (Already chosen) Triggering pattern: **scheduled cron every 5 min + on-demand "Re-run analysis" button**.
3. (Already chosen) Agent output v0: **findings + per-persona briefs** (recommendations later).

### Next coding session order

1. **briefs + agent_runs schema** (task 46) — Alembic migration `0006_agent.py`.
2. **Context retriever** (task 47) — `husn.agent.context.build_dossier(project_id) -> dict`. Pure function, easy to test.
3. **Anthropic client + system prompt** (task 48) — once user provides API key. Includes anti-hallucination check (every cited claim_id exists in input).
4. **Persistence + cron + on-demand endpoint** (task 49) — agent_runs row per run; new findings written into existing `findings` table with `rule_id="AGENT-FINDING-*"`; briefs written into new `briefs` table.
5. **Dashboard surfaces** — extend Drift inbox to render agent findings; add new "Briefs" card with persona selector.

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
| `slack_backfill` | :30 every minute | live |
| `normalize_graph` | :00 :15 :30 :45 | live |
| `extract_claims` | :05 :20 :35 :50 | live |
| `evaluate_drift` (R-DATE-1) | :10 :40 | live |
| `agent_analyze` | every 5 min | **planned (Step 6)** |

### Current data snapshot (last known)

- 6 persons · 6 identities · 1 project ("All work") · 4 scopes
- 27 normalised artifacts · 22 artifact_mentions
- ~30 claims · 1 open finding (`R-DATE-1` release-date drift in Atlas seeded messages: 2026-06-03 vs 2026-06-10)

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

---

## Update protocol

When Claude makes a change:
- **After a code change (no commit):** add a short bullet to `## Recent activity` below (one line, with a timestamp).
- **After a commit:** update `Last commit on main` in the TL;DR table + add the commit hash and one-line summary to `## Recent activity`.
- **After a scope pivot:** add a new section to `## Pivot log`.
- **After a step ships:** update `## Step status` table + add an exit-criteria note.

Keep this file under ~300 lines. Truncate `Recent activity` to last 30 entries.

---

## Recent activity (newest first)

- **2026-05-24** — Plan pivot: bring Step 6 forward, skip remaining deterministic rules. `plan.md` + `knowledge.md` + this file updated. No new code. Awaiting Anthropic API key from user.
- **2026-05-24** — Commit `996b341`: Step 4 R-DATE-1 deterministic baseline (claim_groups + findings + finding_evidence schema, family-key grouper, R-DATE-1 evaluator with auto-close, Drift inbox UI). Fires live on the user's seeded Project Atlas data: "Release date drift in All work: 2026-06-03, 2026-06-10". This is the always-on fallback when the Step 6 agent is down or unavailable.
- **2026-05-23** — Commit `e4bf408`: Step 3 deterministic claims extraction (7 extractors, evidence anchors, dashboard Claims card, cron every 15s). 26 claims extracted on cold boot.
- **2026-05-23** — Commit `0e400c0`: Step 1.5 real Jira + Slack OAuth + Step 2 operational graph with continuous Arq cron sync. 27 artifacts, 22 mentions, in-sync.
- **2026-05-23** — Commit `e3644c0`: Step 1 scaffold (docker compose, FastAPI + SQLAlchemy + Alembic, Next.js dashboard, connector stubs).
- **2026-05-23** — Commit `91c8c02`: initial product brief (`prompt.md`).
