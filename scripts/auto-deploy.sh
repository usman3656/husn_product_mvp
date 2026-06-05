#!/usr/bin/env bash
# scripts/auto-deploy.sh
# Cron-friendly: fetches origin/main, redeploys if there are new commits.
# Quiet on the happy path (nothing to do). Logs to /var/log/husn-auto-deploy.log.
#
# Install via:  ./scripts/install-auto-deploy.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="/var/log/husn-auto-deploy.log"

cd "$REPO"

# Lock so two cron ticks can't race.
exec 9>>"/tmp/husn-auto-deploy.lock"
flock -n 9 || exit 0

git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [[ "$LOCAL" == "$REMOTE" ]]; then
  # Up to date, exit quietly.
  exit 0
fi

{
  echo
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) new commits on origin/main, deploying ==="
  echo "from: $LOCAL"
  echo "to:   $REMOTE"
  "$REPO/scripts/deploy.sh"
  echo "=== done ==="
} >>"$LOG" 2>&1
