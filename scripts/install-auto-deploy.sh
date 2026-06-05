#!/usr/bin/env bash
# scripts/install-auto-deploy.sh
# Installs the auto-deploy cron job + a server-side `redeploy` shortcut.
# Run ONCE on the server:
#   ./scripts/install-auto-deploy.sh
#
# What it does:
#   - Adds a root cron entry that runs auto-deploy.sh every 2 minutes.
#   - Adds an alias `redeploy` so you can manually re-trigger from inside
#     ~/husn without typing the full deploy.sh path.
#   - Creates /var/log/husn-auto-deploy.log with a sensible permission.
#
# Idempotent. Safe to re-run.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTO="$REPO/scripts/auto-deploy.sh"
LOG="/var/log/husn-auto-deploy.log"

if [[ "$EUID" != "0" ]]; then
  echo "ERROR: run this as root (you should already be — this is the husn box)." >&2
  exit 1
fi

if [[ ! -x "$AUTO" ]]; then
  chmod +x "$AUTO"
fi

# 1. Cron entry every 2 minutes. Drop any pre-existing husn auto-deploy lines first.
TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v 'husn-auto-deploy' > "$TMP" || true
echo "*/2 * * * * $AUTO  # husn-auto-deploy" >> "$TMP"
crontab "$TMP"
rm -f "$TMP"
echo "Cron installed: */2 * * * * $AUTO"

# 2. Log file (created on first deploy anyway, but pre-create for visibility).
touch "$LOG"
chmod 640 "$LOG"

# 3. Server-side `redeploy` command. A real script in /usr/local/bin/ rather
# than a shell alias — aliases only work in interactive shells and not when
# ssh-run remotely. This works everywhere, from any cwd, in any session.
cat > /usr/local/bin/redeploy <<'EOF'
#!/usr/bin/env bash
# Manual redeploy of husn.io from the production box.
set -euo pipefail
cd "$(eval echo ~"${SUDO_USER:-$USER}")/husn"
git pull
./scripts/deploy.sh
EOF
chmod +x /usr/local/bin/redeploy
echo "Wrote /usr/local/bin/redeploy (usable from any shell, any cwd)."

# Clean up any prior alias attempt in /root/.bashrc so it doesn't shadow the script.
if [[ -f /root/.bashrc ]] && grep -q '^alias redeploy=' /root/.bashrc; then
  sed -i '/^alias redeploy=/d' /root/.bashrc
  echo "Removed stale 'alias redeploy=' from /root/.bashrc."
fi

echo
echo "Auto-deploy is live. Any push to origin/main will redeploy within ~2 min."
echo "Watch with:  tail -f $LOG"
echo "Disable with: crontab -e   (delete the husn-auto-deploy line)"
