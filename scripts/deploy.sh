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
#   scripts/deploy.sh             # full pull + build + up. If web/ or api/
#                                 # changed since the last deploy, the
#                                 # corresponding service is rebuilt with
#                                 # --no-cache to defeat BuildKit's
#                                 # occasionally-poisoned COPY cache.
#   scripts/deploy.sh --no-build  # skip image rebuild (faster)
#   scripts/deploy.sh --no-cache  # force --no-cache on every service
#   scripts/deploy.sh --logs      # tail after up
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"
BUILD_FLAG="--build"
TAIL_LOGS=0
FORCE_NO_CACHE=0
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD_FLAG="" ;;
    --no-cache) FORCE_NO_CACHE=1 ;;
    --logs) TAIL_LOGS=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f .env.prod ]]; then
  echo "ERROR: .env.prod missing in $REPO_ROOT" >&2
  echo "Copy .env.prod.example, fill it in, chmod 600 .env.prod." >&2
  exit 1
fi

# Remember the pre-pull HEAD so we can detect which service trees actually
# changed. First run (no marker file) treats everything as changed and
# forces no-cache.
LAST_DEPLOY_FILE=".last-deployed-sha"
PREV_SHA=""
[[ -f "$LAST_DEPLOY_FILE" ]] && PREV_SHA=$(cat "$LAST_DEPLOY_FILE")

echo "==> Pulling latest from origin/main"
git fetch --quiet origin main
git reset --hard origin/main
NEW_SHA=$(git rev-parse HEAD)

# Detect which services changed (web/, api/) so we can target --no-cache.
# Docker BuildKit's COPY cache occasionally goes stale and skips real
# changes; targeted --no-cache catches that without rebuilding everything.
SVC_NO_CACHE=()
if [[ "$BUILD_FLAG" == "--build" ]]; then
  if [[ $FORCE_NO_CACHE -eq 1 ]]; then
    SVC_NO_CACHE=(web api worker)
  elif [[ -z "$PREV_SHA" ]]; then
    SVC_NO_CACHE=(web api worker)
  else
    if ! git diff --quiet "$PREV_SHA" "$NEW_SHA" -- web/; then
      SVC_NO_CACHE+=(web)
    fi
    if ! git diff --quiet "$PREV_SHA" "$NEW_SHA" -- api/; then
      SVC_NO_CACHE+=(api worker)
    fi
  fi
fi

if [[ ${#SVC_NO_CACHE[@]} -gt 0 ]]; then
  echo "==> Rebuilding without cache: ${SVC_NO_CACHE[*]}"
  $COMPOSE build --no-cache "${SVC_NO_CACHE[@]}"
fi

echo "==> docker compose up $BUILD_FLAG"
# shellcheck disable=SC2086
$COMPOSE up -d $BUILD_FLAG

echo "$NEW_SHA" > "$LAST_DEPLOY_FILE"

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
