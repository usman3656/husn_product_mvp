#!/usr/bin/env bash
# scripts/diag-prod.sh — one-shot production diagnostic dump.
# Runs read-only inside ~/husn. Paste the output to debug "why isn't X
# showing up" issues without round-tripping ssh commands.
#
# Usage on the box:    bash scripts/diag-prod.sh
# Usage from laptop:   ssh husn 'cd ~/husn && bash -s' < scripts/diag-prod.sh
set -uo pipefail

cd "$(dirname "$0")/.." 2>/dev/null || cd ~/husn
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

hdr() { printf "\n==================== %s ====================\n" "$1"; }

hdr "git HEAD"
git log --oneline -1

hdr "containers"
$C ps

hdr "worker logs (last 80 lines)"
$C logs --tail=80 worker 2>&1 | tail -80

hdr "api logs grepped for backfill / jira / tenant_id / error"
$C logs --tail=200 api 2>&1 | grep -iE "backfill|jira|tenant_id|TypeError|Error|Exception" | tail -30

hdr "raw_artifacts by (tenant_id, source)"
$C exec -T postgres psql -U husn -d husn -c "SELECT tenant_id, source, count(*) FROM raw_artifacts GROUP BY 1,2 ORDER BY 1,2;" 2>&1

hdr "artifacts by (tenant_id, source)"
$C exec -T postgres psql -U husn -d husn -c "SELECT tenant_id, source, count(*) FROM artifacts GROUP BY 1,2 ORDER BY 1,2;" 2>&1

hdr "connections"
$C exec -T postgres psql -U husn -d husn -c "SELECT id, tenant_id, source, account_label, created_at FROM connections ORDER BY id DESC LIMIT 10;" 2>&1

hdr "tenants + memberships"
$C exec -T postgres psql -U husn -d husn -c "SELECT t.id AS tenant_id, t.name, count(m.user_id) AS members FROM tenants t LEFT JOIN memberships m ON m.tenant_id = t.id AND m.status='active' GROUP BY 1,2;" 2>&1

hdr "agent_runs (last 5)"
$C exec -T postgres psql -U husn -d husn -c "SELECT id, tenant_id, project_id, status, started_at, error FROM agent_runs ORDER BY id DESC LIMIT 5;" 2>&1

hdr "DONE"
