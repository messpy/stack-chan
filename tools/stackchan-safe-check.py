#!/usr/bin/env python3
"""Run the existing StackChan read-only --check against a clean integration worktree.

The original stackchan.sh remains authoritative. Never mutate a git checkout.
"""

import argparse
import os
from pathlib import Path
import subprocess
import sys


def git_clean(path: Path) -> bool:
    try:
        inside = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        if inside.returncode or inside.stdout.strip() != "true":
            return False
        status = subprocess.run(
            ["git", "-C", str(path), "status", "--porcelain", "--untracked-files=no"],
            capture_output=True, text=True, timeout=20, check=False,
        )
        return status.returncode == 0 and not status.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return False


def worktrees(root: Path):
    work = root / "work"
    if not work.is_dir():
        return []
    # Newest integration tree first; never use the potentially modified main checkout.
    candidates = [p for p in work.glob("stackchan-pr102-integration-*") if p.is_dir()]
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--projects", type=Path, default=Path.home() / "Stackchan_Projects")
    parser.add_argument("--engine", type=Path, default=Path.home() / "stackchan.sh")
    parser.add_argument("--allow-other-host", action="store_true", help="for isolated unit tests")
    args = parser.parse_args(argv)

    if not args.allow_other_host and os.uname().nodename.split(".")[0] != "kmac":
        print("[FATAL] STEP=HOST REASON=not-kmac", flush=True)
        return 2
    if not args.engine.is_file():
        print("[FATAL] STEP=ENGINE REASON=missing", flush=True)
        return 2

    print("[CHECK] STEP=CLEAN_INTEGRATION_REPO", flush=True)
    chosen = None
    for repo in worktrees(args.projects):
        if not (repo / "firmware" / "package.json").is_file():
            continue
        if not (repo / "firmware" / "node_modules").is_dir():
            continue
        if git_clean(repo):
            chosen = repo
            break
    if chosen is None:
        print("[FATAL] STEP=CLEAN_INTEGRATION_REPO REASON=none", flush=True)
        return 2
    print(f"[INFO] STEP=CHECK_REPO NAME={chosen.name}", flush=True)

    # shell=False, fixed flags. No checkout resets, dependency installs, builds or flashing.
    try:
        check = subprocess.run(
            ["bash", str(args.engine), "--repo", str(chosen), "--log-root", str(args.projects / "runs"), "--check"],
            stdin=subprocess.DEVNULL, check=False,
        )
    except OSError:
        print("[FATAL] STEP=CHECK REASON=command-unavailable", flush=True)
        return 127
    print(f"[INFO] STEP=CHECK EXIT={check.returncode}", flush=True)
    return check.returncode


if __name__ == "__main__":
    sys.exit(main())
