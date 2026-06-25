#!/usr/bin/env bash
# scripts/auto-deploy-staging.sh — poll origin/staging and deploy on change.
# Runs from cron ON THE STAGING BOX only. Install with:
#   */3 * * * * /root/husn-staging/scripts/auto-deploy-staging.sh  # husn-staging-auto-deploy
#
# Single-flighted via flock so overlapping cron ticks can't race. Deploys only
# when origin/staging has actually moved, so it's cheap to run often.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG=/var/log/husn-staging-auto-deploy.log
LOCK=/tmp/husn-staging-auto-deploy.lock

exec 9>"$LOCK"
flock -n 9 || { echo "$(date -u +%FT%TZ) another run in progress, skip" >>"$LOG"; exit 0; }

cd "$REPO_ROOT"
git fetch --quiet origin staging
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/staging)

if [[ "$LOCAL" == "$REMOTE" ]]; then
  exit 0   # nothing new
fi

{
  echo "==================================================================="
  echo "$(date -u +%FT%TZ) staging deploy: $LOCAL -> $REMOTE"
  ./scripts/deploy-staging.sh --fast
  echo "$(date -u +%FT%TZ) staging deploy done"
} >>"$LOG" 2>&1
