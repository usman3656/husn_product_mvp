#!/usr/bin/env bash
# scripts/deploy.sh — production deploy for husn.io.
# Run on the Hetzner box (or via ssh from CI) inside the repo root.
#
# Expectations:
#   - Repo is cloned at ~/husn (or wherever pwd is).
#   - .env.prod sits in the repo root, 0600 owned by the deploy user.
#   - docker + docker compose plugin installed.
#   - This script is idempotent; re-running is safe.
#
# Usage:
#   scripts/deploy.sh             # FULL clean rebuild of every service with
#                                 # --no-cache, then recreate containers.
#                                 # This is the default because BuildKit's
#                                 # COPY cache has burned us repeatedly; the
#                                 # extra ~90s per service is cheap insurance.
#   scripts/deploy.sh --fast      # use BuildKit cache; only rebuilds what
#                                 # actually changed. Use when iterating fast
#                                 # and you trust the cache.
#   scripts/deploy.sh --no-build  # skip image rebuild entirely (just pull+up)
#   scripts/deploy.sh --logs      # tail after up
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
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

if [[ ! -f .env.prod ]]; then
  echo "ERROR: .env.prod missing in $REPO_ROOT" >&2
  echo "Copy .env.prod.example, fill it in, chmod 600 .env.prod." >&2
  exit 1
fi

echo "==> Pulling latest from origin/main"
git fetch --quiet origin main
git reset --hard origin/main
NEW_SHA=$(git rev-parse HEAD)
echo "    at $NEW_SHA"

# DEFAULT: nuke the cache for every service so we can never silently ship
# a stale image again. Use --fast to opt back into cached builds.
if [[ "$BUILD_FLAG" == "--build" && $FAST -eq 0 ]]; then
  echo "==> Full --no-cache rebuild: web, api, worker"
  $COMPOSE build --no-cache web api worker
fi

echo "==> docker compose up $BUILD_FLAG --force-recreate"
# --force-recreate guarantees the running container matches the freshly
# built image even when compose thinks "nothing changed".
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

echo "==> Running alembic migrations"
$COMPOSE exec -T api alembic upgrade head

echo "==> Smoke check"
$COMPOSE exec -T api curl -fsS http://localhost:8000/health || {
  echo "ERROR: /health failed" >&2
  $COMPOSE logs --tail 100 api
  exit 1
}

echo "==> Done."
echo "App:  https://${DOMAIN_APP:-app.husn.io}"
echo "API:  https://${DOMAIN_API:-api.husn.io}"

if [[ $TAIL_LOGS -eq 1 ]]; then
  $COMPOSE logs -f --tail=50
fi
