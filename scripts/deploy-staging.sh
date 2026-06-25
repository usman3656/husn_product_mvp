#!/usr/bin/env bash
# scripts/deploy-staging.sh — deploy for the DEDICATED staging box.
# Mirrors scripts/deploy.sh but targets the staging compose + .env.staging and
# tracks origin/staging. Runs ON the staging box (or via ssh from CI).
#
# This box has NO production stack, so this script cannot affect prod.
#
# Expectations:
#   - Repo cloned at ~/husn-staging (or wherever pwd is), tracking `staging`.
#   - .env.staging in the repo root, chmod 600 (see .env.staging.example).
#   - docker + docker compose plugin installed.
#
# Usage:
#   scripts/deploy-staging.sh            # full --no-cache rebuild + recreate
#   scripts/deploy-staging.sh --fast     # cached build (faster iteration)
#   scripts/deploy-staging.sh --no-build # skip rebuild (just up)
#   scripts/deploy-staging.sh --logs     # tail after up
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f docker-compose.staging.yml --env-file .env.staging"
BUILD_FLAG="--build"
TAIL_LOGS=0
FAST=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD_FLAG="" ;;
    --fast) FAST=1 ;;
    --logs) TAIL_LOGS=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f .env.staging ]]; then
  echo "ERROR: .env.staging missing in $REPO_ROOT" >&2
  echo "Copy .env.staging.example, fill it in, chmod 600 .env.staging." >&2
  exit 1
fi

echo "==> Pulling latest from origin/staging"
git fetch --quiet origin staging
git reset --hard origin/staging
echo "    at $(git rev-parse HEAD)"

if [[ "$BUILD_FLAG" == "--build" && $FAST -eq 0 ]]; then
  echo "==> Full --no-cache rebuild: web, api, worker"
  $COMPOSE build --no-cache web api worker
fi

echo "==> docker compose up $BUILD_FLAG --force-recreate"
# shellcheck disable=SC2086
$COMPOSE up -d $BUILD_FLAG --force-recreate

echo "==> Waiting for api to report healthy"
for i in {1..60}; do
  status=$($COMPOSE ps --format json api | python3 -c 'import sys, json; print(json.loads(sys.stdin.read()).get("Health",""))' 2>/dev/null || echo "")
  if [[ "$status" == "healthy" ]]; then
    echo "    api healthy"
    break
  fi
  sleep 2
done

echo "==> Running alembic migrations (staging DB)"
$COMPOSE exec -T api alembic upgrade head

echo "==> Smoke check"
$COMPOSE exec -T api curl -fsS http://localhost:8000/health || {
  echo "ERROR: /health failed" >&2
  $COMPOSE logs --tail 100 api
  exit 1
}

echo "==> Staging done."
echo "App:  https://${DOMAIN_APP:-staging.husn.io}"
echo "API:  https://${DOMAIN_API:-api-staging.husn.io}"

if [[ $TAIL_LOGS -eq 1 ]]; then
  $COMPOSE logs -f --tail=50
fi
