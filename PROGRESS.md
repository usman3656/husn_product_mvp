# husn — PROGRESS

> Living state log. Read this file first at the start of every Claude session to know where we are. Updated after every meaningful code change and every commit.

---

## TL;DR — where we are right now

| Field | Value |
|---|---|
| Last commit on `main` | `6d859f0` — Organization page redesign + alive Pulse rings |
| **Live URL** | `https://app.husn.io` (Wave 0, single-tenant). API at `https://api.husn.io`. Apex `husn.io` still serves the existing marketing site. |
| Production host | Hetzner CX32 (Falkenstein, Ubuntu 24.04, 178.105.157.152). Stack: `docker compose -f docker-compose.prod.yml` → caddy + web + api + worker + postgres + redis. Worker on `edge + internal` networks (egress fix). |
| Auto-deploy | Cron polls `origin/main` every 2 min and runs `scripts/deploy.sh` if new commits. `husn-deploy` Mac wrapper triggers a manual redeploy. |
| Phase in flight | **Wave 1 Stage 1 — shipped.** Step 5/6 v2 agent (skeleton → renderer → NLI verifier → template fallback) + drift framework expansion (R-OWNER-1, R-STATUS-1) + 3 new extractors (scope, dependency, commitment) all live. **Frontend redesigned end-to-end** as the organizational intelligence layer (Briefing, Ask Husn, Explore, Organization digital twin, Investigations, Connections, Settings, theme toggle). |
| Next | **Wave 1 Stage 2 — tenancy + Auth.js + Stripe + worker LLM resilience.** Plus operational items: register prod OAuth callbacks per `docs/oauth-production.md`; address Groq daily token cap exhaustion (model swap or paid tier). |
| LLM backend | Groq `llama-3.3-70b-versatile` for the renderer + chat. Anthropic Haiku for NLI verifier (JSON mode). `GROQ_API_KEY` + `ANTHROPIC_API_KEY` both set in `.env.prod`. **Known limit:** free-tier daily token cap (~100K/day on 70B model) gets exhausted by the cron renderer; needs paid tier OR `llama-3.1-8b-instant` swap. |
| Services up? | `ssh husn 'cd ~/husn && ./scripts/diag.sh'` — six containers, all healthy. |

---

## Step status

| Step | Status | Notes |
|---|---|---|
| **Wave 0 — Production deploy** | ✅ shipped | App live at `https://app.husn.io`. Hetzner + docker compose + Caddy + Let's Encrypt all green. Auto-deploy from `origin/main` via cron. |
| **1 — Connectors** | ✅ shipped (4/4) | Jira (3LO), Slack (OAuth v2), Google (Gmail + Drive + Docs + Sheets, delta sync), Microsoft (Outlook + OneDrive incl. shared folders, .html/.csv/.txt/.docx/.xlsx content extraction). Per-connection disconnect + reset-sync endpoints. **Per-file read status** surfaced via `/api/connections/{id}/files`. |
| **2 — Operational graph** | ✅ shipped | persons, person_identities, projects, project_sources, artifacts, artifact_mentions. Continuous Arq cron sync. Identity resolution via email lowercase. **People × Project matrix** exposed via `/api/graph/people-projects`. |
| **3 — Claims (deterministic)** | ✅ shipped | Original 7 extractors on Slack + Jira, plus 3 new extractors (scope, dependency, commitment) added in Wave 1 Stage 1. Google + Microsoft normalization done; extractors on those sources still pending (claim path runs only on Slack + Jira artifacts today). |
| **4 — Drift (deterministic)** | ✅ shipped — generalised | Table-driven `DriftRule` Protocol framework. Three rules live: **R-DATE-1** (date conflict), **R-OWNER-1** (ownership ambiguity), **R-STATUS-1** (status drift across sources). Cron `evaluate_drift` runs every 30 min; one finding per `(rule_id, claim_group_id)`. |
| **5 — Propagation** | ⛔ subsumed | Folded into Step 6 v2. Renderer + the "Reach Out For Me" UI affordance decides who needs to know. |
| **6 — Step 5/6 v2 agent (skeleton + typewriter + NLI verifier)** | ✅ shipped — Wave 1 Stage 1 | `husn.agent.skeleton.build_skeleton()` (pure deterministic), `husn.agent.render` (Groq Llama 3.3 70B as constrained renderer with strict typewriter prompt + sanitiser + template fallback), `husn.agent.nli` (Haiku JSON-mode entailment check, default-fail-closed), orchestrated by `husn.agent.run_v2.run_renderer_for_*`. Five personas: TPM, Eng Manager, QA Lead, Security Lead, Ops Manager. Dashboard surfaces persona tabs + side-by-side conflict cards. |
| **6.chat — Ask Husn** | ✅ shipped (UX redesigned) | `/ask` (was `/chat`, redirect kept) — document-style conversation with Conclusion / Evidence / next-step structure. Citations as Source #N / Fact #N footnote chips. Per-question RAG over Postgres ILIKE keyword search. |
| **7 — Feedback loop (clarifications + two-track writes)** | 📋 planned (Wave 1 Stage 2+) | Schema in `plan.md` Step 7. Not started. |
| **7.files — Full file-type coverage** | 📋 planned | .pptx, PDF, full-sheet content, .rtf / .odt / .pages / .keynote. Not started. |
| **8 — Tier 0 alias dictionary** | 📋 planned | Not started. |
| **Connections management** | ✅ shipped (revamped) | `/connections` lists every connection with token health, last-sync time, **expandable per-connection file list** (read / fetched status per file). Disconnect + reset-sync + reset-sync-all. |
| **Frontend redesign (intelligence layer)** | ✅ shipped — Wave 1 Stage 1 | See "Frontend surface" below. |
| **Theme system** | ✅ shipped | Light / Auto / Dark toggle in side-nav. `data-theme` attribute + no-FOUC inline boot script + 200 ms color transitions. |
| **Auto-deploy** | ✅ shipped | Cron polls `origin/main` every 2 min. `husn-deploy` Mac wrapper. `redeploy` real script (not alias) on the box. |
| **Audit watcher** | ✅ shipped | Host-side Python daemon polls the project tree every 4s and runs `.claude/audit.sh` on changes. |

---

## Frontend surface (post-redesign, 2026-06-07)

Repositioned from "dashboard / integration platform" to **organizational intelligence layer**. Six destinations in the side-nav:

| Route | What it is |
|---|---|
| `/` **Briefing** | The homepage IS the product. Six sections in order: **01 Organizational Pulse** (interactive client component: Confidence + Alignment rings with comet orbit + breath + count-up + sparkline + click-to-breakdown, Momentum + Risks beat dots), **02 Most Consequential** (dominating editorial hero with consequence-framed title, confidence bar, Potential Impact + People Closest, Reach Out For Me primary action), **03 Emerging Risks** + **04 Missing Information** as parallel columns, **05 Recommended Actions** (verb-led synthesised to-dos), **06 Active Projects** (pulse-dot workstreams). Ranked by **consequence**, not recency. |
| `/ask` **Ask Husn** | Document-style Q&A. User turn rendered large; Husn answer as structured card (Conclusion + Evidence + next-step strip). Fixed glass composer pinned to reading column. Suggested questions on empty state. `/chat` 301 to `/ask`. |
| `/explore` **Explore** | Organised by **understanding**, not issue type. Seven lenses: Projects · Teams · Risks · Ownership · Dependencies · Decisions · Resolved. |
| `/organization` **Organization** | The **Organizational Digital Twin**. Five sections: **01 Workstreams** (editorial blocks: Owners · Teams involved · Dependencies · Connected decisions), **02 Organizational map** (People × Workstreams matrix — calm grid, intensity-graded dots, hover/click reveals the relationship; no spaghetti), **03 People in the picture** (context cards: "Owns work across N workstreams" / "Touches N"), **04 Decision network** (R-STATUS-1 + R-DEP + agent findings as decisions-in-motion with stacked-avatar influencers), **05 Sources of truth** (quiet chip strip). Answers "How does this organization work?" Not "what needs attention today" — that's the Briefing's job. |
| `/investigations/[id]` **Investigations** | Case-folder layout: hero + side-by-side evidence + timeline + sticky action rail (Reach Out For Me / Collect / Ask / Snooze). |
| `/connections` **Connections** | Demoted to "Workspace · Plumbing". Each connection card has a **Show files** toggle that lazy-loads the per-file list with green = Read (raw + normalized) / amber = Fetched (raw only). |
| `/settings` **Settings** | Workspace, briefing cadence, integrations link, legal pointers. |

**Reach Out For Me.** Cross-cutting client component. Wherever uncertainty surfaces (Briefing hero, Missing Info rows, Recommended Actions, Investigation rail, Critical-Path People), one click opens a modal with: who likely has the answer + why + pre-drafted message + Send via Slack / Email (Copy fallback). Tinted predicted/purple — the semantic colour for predicted/derived information.

**Semantic colour vocabulary.** Green = aligned, Amber = uncertain, Red = active conflict, Purple = predicted, Blue = understood. Used only where meaning is encoded; never decorative.

**Editorial language.** Stable H1s ("Today's brief.", "How this organization works.", etc.). No "five things deserve your attention", no spelled-out counts, no widgets, no metric cards.

---

## Backend additions (Wave 0 + Wave 1 Stage 1)

| Endpoint | What it does |
|---|---|
| `POST /api/admin/backfill-now` | Runs every connection's `backfill_connection` inline in the API process, surfacing exceptions with full traceback. Built to debug worker-side silent failures. |
| `POST /api/connections/{id}/reset-sync` | Drops delta cursors / history tokens so the next backfill is a full scan. |
| `POST /api/connections/reset-sync-all` | Same, bulk. |
| `GET /api/connections/{id}/files` | Joins `RawArtifact` + `Artifact` for per-file read status. Powers the Connections file list. |
| `GET /api/graph/people-projects` | Joins `ArtifactMention` → `Artifact` for person × project involvement counts + dominant role (author/assignee/watcher/mention). Powers the Organization matrix. |
| `husn.agent.skeleton.build_skeleton()` | Pure deterministic function turning claim_groups + findings + claims + evidence into typed JSON. |
| `husn.agent.render.run()` | Strict typewriter renderer with sanitiser + deterministic template fallback. |
| `husn.agent.nli.verify_bullets()` | Haiku-class NLI entailment check; defaults to entails=false on exception (verifier outage never lets bad bullets through). |
| `husn.agent.run_v2.run_renderer_for_*` | Orchestrator: empty-skeleton skip, max 2 render retries, agent_runs persistence. |

**Drift rule framework.** `husn/drift/rules/base.py` defines a `DriftRule` Protocol; rules registered via `ALL_RULES` and evaluated in one commit per tick. R-DATE-1 / R-OWNER-1 / R-STATUS-1 implemented. R-STATUS-1 checks worst-{at_risk, blocked, delayed} vs best-{on_track, complete} within 7 days.

---

## Operational learnings (production)

1. **Worker container needed `edge` network for outbound.** Worker without `edge` died at DNS on every external httpx call (Groq, connectors, OAuth refresh) — exceptions caught silently inside the worker. Fix: commit `327f068` — `worker.networks: [edge, internal]`.
2. **`NEXT_PUBLIC_API_URL` must be a build arg.** Next inlines `NEXT_PUBLIC_*` into the client bundle at build time, so runtime env never reaches client code. Caused the "chat URL is localhost" bug on prod. Fix: `Dockerfile.prod ARG NEXT_PUBLIC_API_URL` + `docker-compose.prod.yml build.args`. Commit `cb5b8b4`.
3. **Microsoft drive_deltas stuck on stale cursor.** After disconnect + reconnect, the new Connection inherited `extra.drive_deltas` and stayed in delta mode returning 0 changes. Fix: `reset-sync` endpoint clears cursor keys; next backfill falls into full-listing branch.
4. **Healthcheck `wget --spider` (HEAD) → 405.** `/healthz` is GET-only. Compose now uses `wget -qO-`. Worker healthcheck `disable: true` (inherits api Dockerfile but doesn't run uvicorn).
5. **`redeploy` had to be a real script, not a bash alias.** Aliases only fire in interactive shells. `install-auto-deploy.sh` writes `/usr/local/bin/redeploy`.
6. **Groq free tier daily token cap.** `llama-3.3-70b-versatile` on demand: ~100K tokens/day per key. The cron renderer (5 personas × N projects × 30 min cadence) exhausts it within hours, after which chat 429s for the rest of the UTC day. Mitigations on the table: (a) swap renderer to `llama-3.1-8b-instant` (higher daily cap), (b) Groq Dev tier ($20/mo, ~10× limits), (c) per-role split — chat → Anthropic, cron → Groq. Not yet acted on; see *What's next*.

---

## Cron schedule (today, on production)

| Job | Cadence | Status |
|---|---|---|
| `jira_backfill` | every 60s | live |
| `google_backfill` | every 60s | live — delta-only after first run |
| `slack_backfill` | every 60s | live |
| `microsoft_backfill` | every 60s | live — delta-only after first run; reset via `/reset-sync` if stuck |
| `normalize_graph` | :00 :15 :30 :45 | live |
| `extract_claims` | :05 :20 :35 :50 | live (Slack + Jira only — Google / Microsoft pending) |
| `evaluate_drift` (R-DATE-1, R-OWNER-1, R-STATUS-1) | every 30 min | live |
| `run_renderer_for_all_projects` (v2 agent) | every 30 min | live — five personas per project. Burns Groq daily quota; see *What's next*. |
| `auto_deploy` (Mac-side / box-side cron) | every 2 min | live — pulls origin/main, runs `scripts/deploy.sh` on new commits |

---

## What's next

### Operational (unblocks ongoing usage)

1. **Groq token budget.** Pick one: swap renderer to `llama-3.1-8b-instant` OR upgrade Groq Dev tier OR split chat → Anthropic / cron → Groq.
2. **Retry-with-`Retry-After` in the LLM client.** Single 429 currently bubbles to the UI. Add backoff in `husn.agent.llm.GroqClient`.
3. **Register prod OAuth callbacks at each provider** per `docs/oauth-production.md`. Atlassian + Slack + Microsoft can be done in one sitting now that the live URLs are stable.
4. **Google CASA submission.** Long pole (6–8 weeks).

### Wave 1 Stage 2 (paying-customer prep)

1. **Tenancy + RLS migration.** Add `tenants` + `users` + invites. RLS keyed on `tenant_id` (column already present everywhere).
2. **Auth.js v5** + Resend magic links + Google SSO.
3. **Tenant signup + onboarding wizard.**
4. **Stripe Checkout + portal + webhook.**
5. **Token encryption at rest** on `connections` (AES-GCM with `TOKEN_ENCRYPTION_KEY`).
6. **GDPR `/admin/erase` endpoint.**
7. **`audit_events` table** + per-action audit writes.
8. **Sentry + Better Stack** (errors + uptime).
9. **CI/CD via GitHub Actions → GHCR.** The cron-poll auto-deploy is the bridge.

### Wave 2 (when we have customers)

- Per-tenant Slack manifest install pattern (already committed to in `knowledge.md` §6).
- Step 7 feedback loop (clarifications + two-track writes).
- Step 8 Tier 0 alias dictionary.
- Full file-type coverage (.pptx, PDF, full sheet content).
- Hetzner managed Postgres.
- WorkOS SSO on first enterprise ask.
- SOC 2 Type II ramp.

---

## Running stack (local dev)

```bash
# from /Users/bawani/idea/go_big_product
docker compose up --build              # boots all six services
open http://localhost:3000             # Briefing
curl http://localhost:8000/health      # {"status":"ok",…}
```

Production diagnostic dump:

```bash
ssh husn 'cd ~/husn && ./scripts/diag.sh'
```

---

## Files that matter

| Doc | What it's for |
|---|---|
| `PROGRESS.md` | **this file** — read first to know where we are |
| `README.md` | high-level overview + quick start |
| `DEPLOY.md` | production deploy plan (Wave 0 / 1 / 2) and current state |
| `ONBOARDING.md` | teammate handoff — clone, SSH alias, husn-deploy, day-to-day |
| `plan.md` | step-by-step build plan + architecture pivots |
| `knowledge.md` | research / market / legal / risk substrate; architecture decisions §11 |
| `docs/jira-setup.md` | how the Jira OAuth integration was registered |
| `docs/slack-setup.md` | how the Slack OAuth integration was registered |
| `docs/google-setup.md` | how the Google OAuth client was registered |
| `docs/microsoft-setup.md` | how the Microsoft Entra app was registered |
| `docs/oauth-production.md` | per-provider checklist for switching to prod OAuth callbacks |
| `prompt.md`, `original-prompt.md` | historical — original SyncGuard brief, kept verbatim |
| `.claude/bin/audit-watcher.{py,sh}` | always-on host-side audit daemon |

---

## Update protocol

When Claude makes a change:
- **After a CODE commit:** update `Last commit on main` + add a line under `## Recent activity`.
- **Doc-only commits updating PROGRESS itself are exempt** from the `Last commit` bump; append to `## Recent activity` only.
- **After a scope pivot:** add a new section to `## Pivot log`.
- **After a step ships:** update `## Step status` + add an exit-criteria note.

Keep this file under ~300 lines. Truncate `Recent activity` to last 30 entries.

---

## Pivot log (newest first)

### 2026-06-07 — Frontend repositioning: intelligence layer, not integration platform

**Decision.** Across three commits (`67764d3`, `283b3eb`, `d319921`, `6d859f0`) the entire frontend was rebuilt to feel like organizational intelligence — chief of staff, not admin dashboard.

- Briefing (homepage) reorganised into six named sections ranked by consequence; Most Consequential Issue dominates.
- Organization page split conceptually from Briefing: it now answers "how does this organization work?" via the Workstreams + People × Workstreams matrix + Decision network. The Briefing answers "what needs my attention today?".
- New cross-cutting "Reach Out For Me" affordance.
- Editorial design language: stable H1s, restrained type, semantic palette (green/amber/red/purple/blue), pulsing live indicators on Pulse rings.
- Light/Dark/Auto theme toggle.

### 2026-06-05 — Wave 0 live, Wave 1 Stage 1 v2 agent shipped

**Decision.** Step 5/6 v2 architecture is now the default agent path on production. Skeleton builder + Groq Llama 3.3 70B renderer + Haiku NLI verifier + deterministic template fallback. Five persona briefs.

### 2026-05-24 (v2) — Architecture deepening: brief skeleton + LLM-as-typewriter + two-track feedback

Locked in three load-bearing commitments after a 7-agent parallel critique pass: event-sourced + materialized views over query-time RAG; LLM-as-typewriter with NLI gating; tiered learning, default deterministic. See `knowledge.md` §11.

### 2026-05-24 — Skip remaining deterministic rules; bring Step 6 (LLM agent) forward

Halt further deterministic rules. Collapse Steps 4-remaining, 5, 7 into a single agent-driven Step 6.

---

## Recent activity (newest first)

- **2026-06-07** — Commit `6d859f0`: Organization page redesigned as the Organizational Digital Twin. Five sections: Workstreams (editorial blocks), Organizational map (People × Workstreams matrix — no spaghetti), People in the picture (context cards), Decision network, Sources of truth (quiet). New endpoint `GET /api/graph/people-projects`. Pulse rings now alive continuously: comet head orbits each ring (8s loop), value arc gently breathes (4s loop), heartbeat center dot retained; respects `prefers-reduced-motion`.
- **2026-06-07** — Commit `d319921`: theme toggle (Light/Auto/Dark in side-nav, no-FOUC inline script), Pulse made interactive (rings draw on mount + gradient stroke + count-up + sparkline + click-to-breakdown), new `GET /api/connections/{id}/files` endpoint + per-connection expandable file list with read/fetched status, first Organization revamp pass.
- **2026-06-07** — Commit `283b3eb`: Husn repositioned as organizational intelligence layer — 6-section Briefing, Reach Out For Me modal, Explore lenses, Investigation case-folder, Ask Husn answer-cards.
- **2026-06-07** — Commits `fcbe13d`, `df621eb`: title cleanup (no more raw backend summaries with 13 dates), value-list collapsibles, ONBOARDING.md hardened (drop hardcoded IdentityFile so any key works).
- **2026-06-05** — Commit `67764d3`: editorial intelligence layer (Briefing replaces masonry, left-rail nav, Ask Husn, Investigations, Organization, theme tokens).
- **2026-06-05** — Commits `120bbcf`, `8571eae`: ONBOARDING.md added (teammate handoff), pared to the actual workflow.
- **2026-06-05** — Commit `327f068`: worker no-internet root-cause fix. Added `edge` network to worker service. Every external httpx call had been dying at DNS resolution.
- **2026-06-05** — Commit `57d4308`: `POST /api/admin/backfill-now` (inline backfill with full traceback). Built specifically to debug silent worker failures.
- **2026-06-05** — Commit `92ad9be`: `POST /api/connections/{id}/reset-sync` + `reset-sync-all`. Clears `gmail_history_id`, `drive_start_page_token`, `drive_changes_page_token`, `drive_deltas`, `outlook_deltas`, `drive_delta_link`.
- **2026-06-04** — Commit `3cd503c`: dashboard persona selector + side-by-side conflict cards (Stage 1 UI).
- **2026-06-04** — Commit `a235c53`: Stage 1 — deterministic extractors for scope (descope/include), dependency (Slack regex + Jira issuelinks "blocks"), commitment (first-person + intent verb + date phrase).
- **2026-06-04** — Commit `109f56c`: Stage 1 — table-driven `DriftRule` Protocol + R-OWNER-1 + R-STATUS-1.
- **2026-06-04** — Commit `cb5b8b4`: chat URL fix. `NEXT_PUBLIC_API_URL` baked at build time via ARG (was using runtime env which never reached client bundle).
- **2026-06-03** — Commit `86965f3`: `scripts/diag.sh` (read-only diagnostic dump for production).
- **2026-06-03** — Commit `a2f28e3`: v2 agent pipeline wired through cron + admin endpoint. `husn.workers.WorkerSettings` runs `run_renderer_for_all_projects`.
- **2026-06-03** — Commit `1a33884`: Stage 1 typewriter renderer module (Groq Llama 3.3 70B, strict system prompt, JSON output schema, sanitiser, template fallback).
- **2026-06-03** — Commit `ef50231`: Stage 1 NLI verifier (Haiku JSON-mode entailment check, defaults to entails=false on exception).
- **2026-06-03** — Commit `62f51c6`: Stage 1 skeleton builder (`husn.agent.skeleton.build_skeleton`).
- **2026-06-02** — Commit `8fa03ae`: `redeploy` becomes a real script in `/usr/local/bin/`, not an alias.
- **2026-06-02** — Commit `4fcdd4d`: auto-deploy cron polls `origin/main` every 2 min, runs `scripts/deploy.sh` on new commits.
- **2026-06-02** — Commit `942d22c`: `husn-deploy` drops into an interactive shell in `~/husn` after a successful deploy.
- **2026-06-02** — Commits `fc9322c`, `b2cf71a`: Mac-side installers — `init-mac-deploy.sh` (`husn-deploy` wrapper) and `init-mac-ssh.sh` (host alias).
- **2026-06-05** — Wave 0 production deploy is live at `https://app.husn.io` (Hetzner CX32 in Falkenstein, Ubuntu 24.04, `178.105.157.152`). docker-compose.prod.yml + Caddy + Let's Encrypt. Apex `husn.io` + `www.husn.io` left at Hostinger pointing at the marketing site.
