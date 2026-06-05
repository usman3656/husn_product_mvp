# husn.io

Alignment layer for technical program managers. Ingests Jira, Slack, Google, and Microsoft, normalises into an operational graph, surfaces drift across sources, and produces per-persona pre-meeting briefs with every sentence cited to its source.

See `plan.md` for the strategic build plan, `knowledge.md` for the research that shapes it (incl. §11 architecture decisions), `PROGRESS.md` for the living state log, and `DEPLOY.md` for the production deploy plan.

**Architecture in one line.** Event-sourced ingest → typed graph + per-(project, persona) materialized views → deterministic brief skeleton → LLM-as-typewriter (renderer only, NLI-verified) → per-persona briefs with every sentence source-linked. RAG only powers the `/chat` surface; never the brief path.

## Live

- **App:** <https://app.husn.io>
- **API:** <https://api.husn.io>
- **Apex `husn.io`** still serves the existing marketing site (unrelated to this repo).

The live app is the **Wave 0** single-tenant deploy. Multi-tenancy, auth, and billing land in Wave 1. See `DEPLOY.md`.

## Quick start (local)

```bash
cp .env.example .env
docker compose up --build
```

- API: <http://localhost:8000/health>
- Web: <http://localhost:3000>

## Production deploy

Production runs on a Hetzner CX32 behind Caddy with auto Let's Encrypt:

```bash
# on the production host, in the cloned repo
./scripts/init-env.sh   # one-time: generate .env.prod with strong secrets
./scripts/deploy.sh     # pull, build, up, alembic upgrade, smoke check
```

See `DEPLOY.md` for the full Wave 0 → Wave 1 → Wave 2 plan, cost breakdown, and OAuth provider checklist (`docs/oauth-production.md`).

## Repo layout

```
api/                       FastAPI app, SQLAlchemy models, Alembic migrations, connectors, Arq workers
web/                       Next.js 15 dashboard (TS + Tailwind)
docs/                      Setup + reference docs (per-connector + OAuth production checklist)
scripts/                   deploy.sh, init-env.sh
docker-compose.yml         Local dev
docker-compose.prod.yml    Production (caddy + web + api + worker + postgres + redis)
Caddyfile                  Production reverse proxy + Let's Encrypt
.env.prod.example          Production env template
DEPLOY.md                  Production deploy plan
PROGRESS.md                Living state log
plan.md                    Strategic build plan
knowledge.md               Research + architecture decisions
.claude/                   PostToolUse audit hook
```

## Where we are

**Wave 0 live; Wave 0 follow-ups pending.** Single-tenant app reachable at `https://app.husn.io`. Still to do before customer 1: register prod OAuth callbacks at each provider, ship placeholder TOS/privacy pages, start Google CASA verification (6-8 week long pole). Then Wave 1 (tenants + auth + Stripe + Step 6 v2 agent rewrite). See `DEPLOY.md` and `PROGRESS.md` for the live snapshot.
