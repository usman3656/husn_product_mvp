# husn.io

Coordination layer for cross-functional enterprise programs. See `plan.md` for the build plan, `knowledge.md` for the research that shapes it (incl. §11 architecture decisions), and `PROGRESS.md` for current state.

**Architecture in one line.** Event-sourced ingest → typed graph + per-(project, persona) materialized views → deterministic brief skeleton → LLM-as-typewriter (renderer only, NLI-verified) → per-persona briefs with every sentence source-linked. RAG only powers the future `/chat` surface; never the brief path.

## Quick start (local)

```bash
cp .env.example .env
docker compose up --build
```

- API: <http://localhost:8000/health>
- Web: <http://localhost:3000>

## Repo layout

```
api/        FastAPI app, SQLAlchemy models, Alembic migrations, connectors, Arq workers
web/        Next.js 15 dashboard (TS + Tailwind + shadcn/ui)
infra/      Compose extensions, deployment manifests (later)
.claude/    PostToolUse audit hook — runs after every Write/Edit
```

## Where we are

**Step 1 — Read-only connector dashboard.** Foundation scaffolded; connectors are module stubs awaiting OAuth wiring per `plan.md` Step 1 exit criteria.
