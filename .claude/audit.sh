#!/usr/bin/env bash
# husn.io audit hook
# Runs after every Write/Edit/MultiEdit. Spawns a headless Claude review against
# knowledge.md + plan.md + the changed file. Output appended to .claude/audit.log.
# Never blocks the parent edit (always exits 0).

set -uo pipefail

PROJECT_ROOT="/Users/bawani/idea/go_big_product"
KNOWLEDGE="${PROJECT_ROOT}/knowledge.md"
PLAN="${PROJECT_ROOT}/plan.md"
LOG="${PROJECT_ROOT}/.claude/audit.log"

payload="$(cat)"

# Extract fields from the hook payload
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"
  tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // empty')"
else
  file_path="$(printf '%s' "$payload" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null)"
  tool_name="$(printf '%s' "$payload" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tool_name",""))' 2>/dev/null)"
fi

[[ -z "${file_path:-}" ]] && exit 0

# Only audit files inside the project tree
case "$file_path" in
  "${PROJECT_ROOT}"/*) ;;
  *) exit 0 ;;
esac

# Skip audit infra & planning docs to avoid recursion / noise
case "$file_path" in
  "${PROJECT_ROOT}/.claude/"*) exit 0 ;;
  "${PROJECT_ROOT}/knowledge.md") exit 0 ;;
  "${PROJECT_ROOT}/plan.md") exit 0 ;;
  "${PROJECT_ROOT}/prompt.md") exit 0 ;;
  "${PROJECT_ROOT}/PROGRESS.md") exit 0 ;;
  "${PROJECT_ROOT}/docs/"*) exit 0 ;;
esac

[[ ! -f "$KNOWLEDGE" || ! -f "$PLAN" ]] && exit 0
command -v claude >/dev/null 2>&1 || exit 0

# Build the prompt with Python — no shell heredoc surprises with backticks / parens / etc.
prompt="$(
  FILE="$file_path" TOOL="${tool_name:-unknown}" \
  KNOWLEDGE_PATH="$KNOWLEDGE" PLAN_PATH="$PLAN" \
  python3 <<'PY'
import os, pathlib

def head(p, n=200):
    try:
        return "\n".join(pathlib.Path(p).read_text(errors="replace").splitlines()[:n])
    except FileNotFoundError:
        return "(missing)"

file = os.environ.get("FILE", "")
tool = os.environ.get("TOOL", "unknown")
knowledge = head(os.environ["KNOWLEDGE_PATH"])
plan = head(os.environ["PLAN_PATH"])
changed = head(file) if file and os.path.isfile(file) else "(file no longer exists)"

print(f"""You are the husn.io build auditor. A file was just edited.
Read knowledge.md and plan.md, then the changed file. Answer in <= 12 lines total.
Be terse. No preamble.

Answer 4 questions:
1) ALIGNMENT - does this change advance the current step in plan.md? Which step? If unclear, say so.
2) DRIFT - does it conflict with anything in knowledge.md (ToS, anti-monitoring guardrails, ICP, killed items like the CC shadow inbox)?
3) SCOPE - over-engineering, premature abstraction, scope creep beyond the current step?
4) CORRECTNESS - anything obviously wrong on the face of it (security, bugs, broken contracts)?

Format:
ALIGN: <one line>
DRIFT: <one line, or none>
SCOPE: <one line, or ok>
BUGS: <one line, or none spotted>

Changed file: {file}
Tool: {tool}

--- knowledge.md (excerpt) ---
{knowledge}

--- plan.md (excerpt) ---
{plan}

--- changed file (first 200 lines) ---
{changed}
""")
PY
)"

{
  printf '\n[husn.io audit] %s @ %s @ %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "${tool_name:-edit}" "$file_path"
  printf '%s\n' "$prompt" \
    | claude -p --model haiku --output-format text 2>/dev/null \
    | sed 's/^/[husn.io audit] /'
  printf '[husn.io audit] ---\n'
} >>"$LOG" 2>&1 || true

exit 0
