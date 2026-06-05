#!/usr/bin/env bash
# scripts/init-mac-deploy.sh
# Installs a Mac-side `husn-deploy` command that runs
#   ssh husn 'cd ~/husn && git pull && ./scripts/deploy.sh'
# from anywhere on your Mac.
#
# Run from your Mac (NOT the server):
#   curl -fsSL https://raw.githubusercontent.com/usman3656/husn_product_mvp/main/scripts/init-mac-deploy.sh | bash
#
# Idempotent. Cleans up any broken `husn-deploy` alias lines from earlier
# attempts in ~/.zshrc.

set -euo pipefail

BIN_DIR="$HOME/.local/bin"
WRAPPER="$BIN_DIR/husn-deploy"
ZSHRC="$HOME/.zshrc"

mkdir -p "$BIN_DIR"

# 1. Write the wrapper script.
cat > "$WRAPPER" <<'EOF'
#!/usr/bin/env bash
# One-shot redeploy of husn.io.
# Runs over SSH to the production box: git pull + deploy, then leaves you
# in an interactive shell inside ~/husn so you can keep working (or just
# `exit` to come back to your Mac).
#
# Usage:
#   husn-deploy          # pull + deploy, then drop into ~/husn shell
#   husn-deploy --quit   # pull + deploy, then disconnect (no shell)
set -euo pipefail
if [[ "${1:-}" == "--quit" ]]; then
  ssh husn 'cd ~/husn && git pull && ./scripts/deploy.sh'
else
  # -t forces a pseudo-TTY so the interactive shell at the end works.
  # `;` (not &&) keeps the shell open even if the deploy fails — useful
  # for debugging in place.
  ssh -t husn 'cd ~/husn && git pull && ./scripts/deploy.sh ; cd ~/husn && exec bash -l'
fi
EOF
chmod +x "$WRAPPER"
echo "Wrote $WRAPPER"

# 2. Clean any prior broken `husn-deploy` alias lines from ~/.zshrc.
if [[ -f "$ZSHRC" ]]; then
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  cp "$ZSHRC" "$ZSHRC.bak.$ts"
  # Drop any line that mentions husn-deploy (alias or otherwise) so the
  # broken paste from earlier stops erroring on every new shell.
  awk '!/husn-deploy/' "$ZSHRC" > "$ZSHRC.tmp" && mv "$ZSHRC.tmp" "$ZSHRC"
  echo "Cleaned ~/.zshrc (backup at ~/.zshrc.bak.$ts)"
fi

# 3. Make sure ~/.local/bin is on PATH for future shells.
if ! grep -q 'HOME/.local/bin' "$ZSHRC" 2>/dev/null; then
  printf '\n# husn.io deploy helper\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$ZSHRC"
  echo "Added ~/.local/bin to PATH in ~/.zshrc"
fi

echo
echo "Done. Open a NEW Terminal window (or run: source ~/.zshrc) and try:"
echo "  husn-deploy"
