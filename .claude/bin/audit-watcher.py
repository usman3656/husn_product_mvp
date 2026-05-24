#!/usr/bin/env python3
"""Continuously watch the husn.io project tree and run the audit script
whenever a watched file changes.

No external dependencies. Polls every WATCH_INTERVAL seconds and diffs
(path, mtime_ns) tuples. Calls .claude/audit.sh with a synthetic hook
payload so the existing audit logic (skip-list, model call, log append)
is reused — single source of truth for what an audit looks like.

Designed to run as: nohup python3 audit-watcher.py >/tmp/husn-watcher.log 2>&1 &
Stops on SIGTERM or via 'pkill -f audit-watcher.py'.

Skips:
  - .claude/* (audit infra and audit log itself)
  - PROGRESS.md / plan.md / knowledge.md / prompt.md (planning docs)
  - docs/* (setup docs)
  - .git/*, node_modules/, __pycache__/, .next/, postgres_data/, redis_data/
  - The watcher's own log file
"""
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path("/Users/bawani/idea/go_big_product")
AUDIT_SCRIPT = PROJECT_ROOT / ".claude" / "audit.sh"
WATCH_INTERVAL = 4.0  # seconds between polls — fast enough for "instant" feel
HEARTBEAT_INTERVAL = 600  # seconds between "still alive" log lines

EXCLUDE_DIR_NAMES = {
    ".git",
    "node_modules",
    "__pycache__",
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".turbo",
    "postgres_data",
    "redis_data",
    "out",
}
EXCLUDE_PATH_PREFIXES = {
    str(PROJECT_ROOT / ".claude"),
    str(PROJECT_ROOT / "docs"),
}
EXCLUDE_FILES = {
    str(PROJECT_ROOT / "PROGRESS.md"),
    str(PROJECT_ROOT / "plan.md"),
    str(PROJECT_ROOT / "knowledge.md"),
    str(PROJECT_ROOT / "prompt.md"),
    str(PROJECT_ROOT / ".env"),
}
EXCLUDE_SUFFIXES = (".pyc", ".log", ".tsbuildinfo")

running = True


def handle_sigterm(_signum, _frame):
    global running
    running = False
    print("[audit-watcher] received SIGTERM, exiting cleanly", flush=True)


def is_excluded(path: Path) -> bool:
    s = str(path)
    if s in EXCLUDE_FILES:
        return True
    for prefix in EXCLUDE_PATH_PREFIXES:
        if s.startswith(prefix + os.sep) or s == prefix:
            return True
    if path.suffix in EXCLUDE_SUFFIXES:
        return True
    return False


def snapshot() -> dict[str, int]:
    out: dict[str, int] = {}
    for dirpath, dirnames, filenames in os.walk(PROJECT_ROOT):
        # Prune excluded dirs in-place
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIR_NAMES]
        for fn in filenames:
            full = Path(dirpath) / fn
            if is_excluded(full):
                continue
            try:
                out[str(full)] = full.stat().st_mtime_ns
            except FileNotFoundError:
                continue
    return out


def trigger_audit(path: str) -> None:
    """Invoke .claude/audit.sh with a synthetic Write payload so the existing
    audit pipeline runs (skip-list / claude -p / log append).
    """
    payload = json.dumps(
        {
            "tool_name": "fswatch",
            "tool_input": {"file_path": path},
            "tool_response": {"success": True},
        }
    )
    try:
        subprocess.run(
            ["bash", str(AUDIT_SCRIPT)],
            input=payload,
            text=True,
            timeout=120,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        print(f"[audit-watcher] audit timeout for {path}", flush=True)
    except Exception as e:
        print(f"[audit-watcher] audit error for {path}: {e}", flush=True)


def main() -> int:
    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    if not AUDIT_SCRIPT.is_file():
        print(f"[audit-watcher] audit script missing: {AUDIT_SCRIPT}", flush=True)
        return 1

    print(
        f"[audit-watcher] watching {PROJECT_ROOT} every {WATCH_INTERVAL}s "
        f"(pid={os.getpid()})",
        flush=True,
    )

    prev = snapshot()
    print(f"[audit-watcher] initial snapshot: {len(prev)} files", flush=True)
    last_heartbeat = time.time()

    while running:
        time.sleep(WATCH_INTERVAL)
        try:
            cur = snapshot()
        except Exception as e:
            print(f"[audit-watcher] snapshot error: {e}", flush=True)
            continue

        changed: list[str] = []
        for path, mtime in cur.items():
            if path not in prev or prev[path] != mtime:
                changed.append(path)

        if changed:
            # Cap to avoid an audit storm on a mass-modify (e.g. git checkout)
            if len(changed) > 5:
                print(
                    f"[audit-watcher] {len(changed)} files changed at once; "
                    f"auditing first 5 only",
                    flush=True,
                )
            for path in changed[:5]:
                print(f"[audit-watcher] audit triggered for {path}", flush=True)
                trigger_audit(path)

        prev = cur

        if time.time() - last_heartbeat > HEARTBEAT_INTERVAL:
            print(
                f"[audit-watcher] heartbeat: {len(cur)} files tracked",
                flush=True,
            )
            last_heartbeat = time.time()

    return 0


if __name__ == "__main__":
    sys.exit(main())
