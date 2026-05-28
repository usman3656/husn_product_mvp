#!/usr/bin/env bash
# Build the husn.io static snapshot and publish it to the gh-pages branch.
#
# GitHub Pages can only serve static files — no FastAPI/Postgres/Redis. So we
# build a Next.js `output: export` snapshot with DEMO_MODE on (interactive
# controls disabled, canned chat transcript) and the real Project Atlas graph
# data baked in at build time (the build runs inside the web container while the
# API is live). The result in web/out/ is force-pushed to the gh-pages branch.
#
# Served at: https://usman3656.github.io/husn_product_mvp/
#
# Usage: scripts/deploy-pages.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REMOTE_URL="$(git remote get-url origin)"
BASE_PATH="${NEXT_BASE_PATH:-/husn_product_mvp}"

echo "==> Building static export (DEMO_MODE, real data baked from live API)…"
docker compose exec -T \
  -e NEXT_OUTPUT_EXPORT=1 \
  -e NEXT_PUBLIC_DEMO_MODE=1 \
  -e NEXT_BASE_PATH="$BASE_PATH" \
  -e API_URL=http://api:8000 \
  -e NEXT_PUBLIC_API_URL=https://usman3656.github.io \
  web npm run build

OUT="$ROOT/web/out"
[ -d "$OUT" ] || { echo "ERROR: $OUT not found — build failed?" >&2; exit 1; }

echo "==> Publishing $OUT to gh-pages…"
touch "$OUT/.nojekyll"            # stop GitHub from running Jekyll (drops _next/)
cd "$OUT"
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.email="deploy@husn.io" -c user.name="husn deploy" \
  commit -qm "Deploy husn.io static demo snapshot"
git push -f "$REMOTE_URL" gh-pages

echo "==> Done. Enable Pages → Branch: gh-pages / root, then visit:"
echo "    https://usman3656.github.io${BASE_PATH}/"
