#!/usr/bin/env bash
# scripts/init-env.sh
# Generate a fresh .env.prod from .env.prod.example with strong secrets.
# Run once on the production host. Refuses to overwrite a real .env.prod.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET=.env.prod
EXAMPLE=.env.prod.example

if [[ ! -f "$EXAMPLE" ]]; then
  echo "ERROR: $EXAMPLE missing in $ROOT" >&2
  exit 1
fi

if [[ -f "$TARGET" ]] && ! grep -q "CHANGE_ME" "$TARGET"; then
  echo "ERROR: $TARGET already exists and has no CHANGE_ME placeholders." >&2
  echo "If you really want to regenerate, delete it first: rm $TARGET" >&2
  exit 1
fi

cp "$EXAMPLE" "$TARGET"

SESSION_SECRET=$(openssl rand -hex 32)
TOKEN_KEY=$(openssl rand -base64 32 | tr -d '\n')
PG_PASS=$(openssl rand -base64 24 | tr -d '/=+\n')

# Use python for substitution: avoids sed escaping issues with base64 (/+=).
SESSION_SECRET="$SESSION_SECRET" TOKEN_KEY="$TOKEN_KEY" PG_PASS="$PG_PASS" \
TARGET="$TARGET" python3 <<'PYEOF'
import os, re
p = os.environ["TARGET"]
data = open(p).read()
data = re.sub(r'^SESSION_SECRET=.*', f"SESSION_SECRET={os.environ['SESSION_SECRET']}", data, count=1, flags=re.M)
data = re.sub(r'^TOKEN_ENCRYPTION_KEY=.*', f"TOKEN_ENCRYPTION_KEY={os.environ['TOKEN_KEY']}", data, count=1, flags=re.M)
data = re.sub(r'^POSTGRES_PASSWORD=.*', f"POSTGRES_PASSWORD={os.environ['PG_PASS']}", data, count=1, flags=re.M)
open(p, "w").write(data)
PYEOF

chmod 600 "$TARGET"

remaining=$(grep -c CHANGE_ME "$TARGET" || true)
echo "Wrote $TARGET. CHANGE_ME placeholders remaining: $remaining (expect 0)."
if [[ "$remaining" != "0" ]]; then
  echo "WARN: some placeholders were not replaced. Open $TARGET and check." >&2
  exit 1
fi

echo
echo "Next: open $TARGET and set ACME_EMAIL to a real email (for SSL cert"
echo "expiry warnings). Leave OAuth client IDs/secrets blank for now."
echo "  nano $TARGET"
