#!/usr/bin/env bash
# scripts/diag.sh
# Production diagnostic dump. Designed to be safe: read-only, no secrets in
# output, no destructive ops. Run on the server:
#   ./scripts/diag.sh
# Or from your Mac in one shot:
#   ssh husn 'cd ~/husn && ./scripts/diag.sh'
#
# Output is a single block of text safe to paste back into chat.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

section () { printf "\n========== %s ==========\n" "$1"; }

section "containers"
$COMPOSE ps 2>&1 | head -20

section "host"
echo "uptime:   $(uptime 2>/dev/null | sed 's/^ *//')"
echo "disk:     $(df -h / | tail -1 | awk '{print $5" used, "$4" free"}')"
echo "mem:      $(free -m 2>/dev/null | awk '/^Mem:/ {printf "%dM used / %dM total\n", $3, $2}')"

section "api health (internal)"
$COMPOSE exec -T api curl -fsS http://localhost:8000/health 2>&1 | head -5 || true
echo
$COMPOSE exec -T api curl -fsS http://localhost:8000/health/lite 2>&1 | head -3 || true

section "connections (counts only, no secrets)"
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-husn}" -d "${POSTGRES_DB:-husn}" -t -c \
  "select source, count(*), max(updated_at) from connections group by source order by source;" 2>&1 | sed '/^$/d' || true

section "raw_artifacts (last fetch per source)"
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-husn}" -d "${POSTGRES_DB:-husn}" -t -c \
  "select source, count(*), max(fetched_at) from raw_artifacts group by source order by source;" 2>&1 | sed '/^$/d' || true

section "artifacts (normalized, by source)"
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-husn}" -d "${POSTGRES_DB:-husn}" -t -c \
  "select source, count(*), max(occurred_at) from artifacts group by source order by source;" 2>&1 | sed '/^$/d' || true

section "claims (count by kind)"
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-husn}" -d "${POSTGRES_DB:-husn}" -t -c \
  "select kind, count(*) from claims group by kind order by count(*) desc;" 2>&1 | sed '/^$/d' || true

section "findings (count by status)"
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-husn}" -d "${POSTGRES_DB:-husn}" -t -c \
  "select status, count(*) from findings group by status;" 2>&1 | sed '/^$/d' || true

section "agent_runs (last 10)"
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER:-husn}" -d "${POSTGRES_DB:-husn}" -t -c \
  "select id, status, model, finding_count, brief_count, started_at, error from agent_runs order by id desc limit 10;" 2>&1 | sed '/^$/d' || true

section "worker logs (last 80 lines)"
$COMPOSE logs --tail 80 worker 2>&1 | tail -80

section "api logs (last 40 lines)"
$COMPOSE logs --tail 40 api 2>&1 | tail -40

section "env shape (keys only, never values)"
grep -E '^[A-Z_]+=' .env.prod 2>/dev/null \
  | awk -F= '{print $1, ($2=="" ? "BLANK" : (length($2)>0 ? "set" : "BLANK"))}' \
  || echo ".env.prod not readable"

section "auto-deploy log (last 30 lines)"
tail -30 /var/log/husn-auto-deploy.log 2>/dev/null || echo "no auto-deploy log yet"

section "done"
echo "diag at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
