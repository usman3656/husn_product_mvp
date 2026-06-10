# husn

**The intelligence layer for your organization.** Husn reads across the tools your work actually lives in — Jira, Slack, Google, Microsoft — and tells you what's drifting, what's owned, and what's at risk, before the status meeting.

Not a dashboard. Not a project tool. A chief of staff that briefs you in 60 seconds.

See `plan.md` for the strategic build plan, `knowledge.md` for the research that shapes it (incl. §11 architecture decisions), `PROGRESS.md` for the living state log, `DEPLOY.md` for the production deploy plan, and `ONBOARDING.md` for teammate setup.

**Architecture in one line.** Event-sourced ingest → typed graph + per-(project, persona) materialized views → deterministic brief skeleton → LLM-as-typewriter (renderer only, NLI-verified) → per-persona briefs with every sentence source-linked. RAG only powers the `/ask` surface; never the brief path.

---

## Live

- **App:** <https://app.husn.io>
- **API:** <https://api.husn.io>
- **Apex `husn.io`** still serves the existing marketing site (unrelated to this repo).

Wave 0 single-tenant deploy is live. Wave 1 Stage 1 — v2 agent (skeleton + renderer + NLI verifier) and the full frontend repositioning as the organizational intelligence layer — is shipped. Wave 1 Stage 2 (tenancy + auth + billing) is next. See `DEPLOY.md`.

---

## The product surface

Six destinations, all under the side-nav:

| Route | What it is |
|---|---|
| `/` **Briefing** | The homepage IS the product. Six sections ranked by consequence: Organizational Pulse · Most Consequential · Emerging Risks · Missing Information · Recommended Actions · Active Projects. The Pulse rings are alive (continuous comet orbit + breath). |
| `/ask` **Ask Husn** | Document-style Q&A with explicit Conclusion / Evidence structure. Every claim cites its source. (Older `/chat` URL redirects here.) |
| `/explore` **Explore** | Organised by understanding, not issue type: Projects · Teams · Risks · Ownership · Dependencies · Decisions · Resolved. |
| `/organization` **Organization** | The **Organizational Digital Twin**: Workstreams + People × Workstreams matrix + People in context + Decision network + Sources of truth. Answers "how does this organization work?" |
| `/investigations/[id]` **Investigation** | Case-folder view per finding: evidence side-by-side + timeline + sticky action rail with **Reach Out For Me**. |
| `/connections` **Connections** | Workspace · plumbing. Each connection expands to a per-file read/fetched status list. |
| `/settings` **Settings** | Workspace · briefing cadence · integrations link · legal pointers. |

**Cross-cutting affordance: Reach Out For Me.** Wherever Husn surfaces uncertainty, one click opens a modal: who likely has the answer + why + draft message + Send via Slack/Email. Tinted predicted-purple — the colour Husn uses for *derived* information.

**Theme.** Light / Auto / Dark toggle in the side-nav. Saved per browser, applied before first paint (no flash).

---

## Quick start (local)

```bash
cp .env.example .env
docker compose up --build
```

- App: <http://localhost:3000>
- API: <http://localhost:8000/health>

For real LLM-backed surfaces (briefs, Ask Husn) you need your own `GROQ_API_KEY` + `ANTHROPIC_API_KEY` in `.env`. Don't reuse production keys; rotate them in <https://console.groq.com> and <https://console.anthropic.com>.

---

## Production deploy

Hetzner CX32 in Falkenstein behind Caddy with auto Let's Encrypt:

```bash
# on the production host, in the cloned repo
./scripts/init-env.sh   # one-time: generate .env.prod with strong secrets
./scripts/deploy.sh     # pull, build, up, alembic upgrade, smoke check
./scripts/install-auto-deploy.sh  # cron polls origin/main every 2 min
```

From your Mac:

```bash
bash scripts/init-mac-ssh.sh     # writes ~/.ssh/config with husn alias
bash scripts/init-mac-deploy.sh  # installs husn-deploy wrapper
husn-deploy                       # one-shot redeploy from anywhere
```

See `ONBOARDING.md` for the full path from "I have the repo" to "I'm running it on prod".

---

## Repo layout

```
api/                       FastAPI app, SQLAlchemy models, Alembic migrations, connectors, Arq workers
  husn/agent/              skeleton + render + nli + run_v2 (the v2 agent pipeline)
  husn/drift/rules/        DriftRule Protocol + R-DATE-1 / R-OWNER-1 / R-STATUS-1
  husn/claims/extractors/  extractors per (source, kind)
  husn/connectors/         Jira / Slack / Google / Microsoft
  husn/routers/            FastAPI routers (graph, findings, agent, chat, connections, admin_diag, …)
web/                       Next.js 15 App Router (TS + Tailwind)
  app/                     routes: page (Briefing), ask, explore, organization, investigations/[id], connections, settings
  components/              pulse, reach-out, org-matrix, critical-people, weekly-signal, theme-toggle, side-nav, …
docs/                      Setup docs per connector + OAuth production checklist
scripts/                   deploy.sh, init-env.sh, init-mac-ssh.sh, init-mac-deploy.sh, install-auto-deploy.sh, diag.sh, auto-deploy.sh
docker-compose.yml         Local dev
docker-compose.prod.yml    Production (caddy + web + api + worker + postgres + redis)
Caddyfile                  Production reverse proxy + Let's Encrypt
.env.prod.example          Production env template
DEPLOY.md                  Production deploy plan
ONBOARDING.md              Teammate handoff
PROGRESS.md                Living state log — read first
plan.md                    Strategic build plan
knowledge.md               Research + architecture decisions
.claude/                   PostToolUse audit hook
```

---

## Where we are

**Wave 0 live; Wave 1 Stage 1 shipped.** Single-tenant app at `https://app.husn.io`. Auto-deploy from `origin/main` every 2 min. v2 agent pipeline (skeleton + renderer + NLI verifier) running on five personas. Frontend redesigned end-to-end. Three drift rules live (R-DATE-1, R-OWNER-1, R-STATUS-1). Six new endpoints surfaced for the redesign. See `PROGRESS.md` for the live snapshot and `DEPLOY.md` for what's next.

**Operational caveat.** The Groq free-tier daily token cap on `llama-3.3-70b-versatile` gets exhausted by the cron renderer within a few hours each day; chat 429s for the remainder of the UTC day. Three mitigations on the table — swap renderer model to `llama-3.1-8b-instant`, upgrade Groq Dev tier, or split chat → Anthropic / cron → Groq. None are picked yet.
