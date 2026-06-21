#!/usr/bin/env bash
# scripts/auto-deploy-staging.sh
# Cron-friendly: redeploy STAGING when the `staging` branch has new commits.
# Quiet on the happy path. Logs to /var/log/husn-staging-auto-deploy.log.
# Install: add a root cron entry (every 2 min):
#   */2 * * * * /home/<user>/husn-staging/scripts/auto-deploy-staging.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="/var/log/husn-staging-auto-deploy.log"
cd "$REPO"

# Lock so two cron ticks can't race.
exec 9>>"/tmp/husn-staging-auto-deploy.lock"
flock -n 9 || exit 0

git fetch origin staging --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/staging)
if [[ "$LOCAL" == "$REMOTE" ]]; then
  exit 0
fi

{
  echo
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) staging: new commits, deploying ==="
  echo "from: $LOCAL  to: $REMOTE"
  "$REPO/scripts/deploy-staging.sh" --fast
  echo "=== done ==="
} >>"$LOG" 2>&1
