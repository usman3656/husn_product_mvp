#!/usr/bin/env bash
# scripts/deploy-staging.sh — deploy the STAGING stack.
#
# Runs from a SEPARATE checkout (~/husn-staging) tracking the `staging` branch,
# using docker-compose.staging.yml + .env.staging. It does NOT touch prod (prod
# is a different Compose project + working tree). Mirrors scripts/deploy.sh.
#
# Usage on the box:
#   cd ~/husn-staging && ./scripts/deploy-staging.sh            # clean rebuild
#   cd ~/husn-staging && ./scripts/deploy-staging.sh --fast     # cached build
#   cd ~/husn-staging && ./scripts/deploy-staging.sh --no-build # pull + up only
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f docker-compose.staging.yml --env-file .env.staging"
BUILD_FLAG="--build"
FAST=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD_FLAG="" ;;
    --fast) FAST=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f .env.staging ]]; then
  echo "ERROR: .env.staging missing in $REPO_ROOT (copy .env.staging.example, fill it, chmod 600)." >&2
  exit 1
fi

echo "==> Pulling latest from origin/staging"
git fetch --quiet origin staging
git reset --hard origin/staging
echo "    at $(git rev-parse --short HEAD)"

if [[ "$BUILD_FLAG" == "--build" && $FAST -eq 0 ]]; then
  echo "==> Full --no-cache rebuild: web, api, worker"
  $COMPOSE build --no-cache web api worker
fi

echo "==> compose up $BUILD_FLAG --force-recreate"
# shellcheck disable=SC2086
$COMPOSE up -d $BUILD_FLAG --force-recreate

echo "==> Waiting for staging api to report healthy"
for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:8001/health/lite >/dev/null 2>&1; then
    echo "    staging api healthy"; break
  fi
  sleep 2
done

echo "==> Running alembic migrations (staging DB)"
$COMPOSE exec -T api alembic upgrade head

echo "==> Smoke check"
$COMPOSE exec -T api curl -fsS http://localhost:8000/health || {
  echo "ERROR: staging /health failed" >&2
  $COMPOSE logs --tail 100 api
  exit 1
}

echo "==> Staging done.  https://${DOMAIN_API:-api-staging.husn.io} | https://${DOMAIN_APP:-staging.husn.io}"
