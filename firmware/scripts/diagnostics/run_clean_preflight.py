#!/usr/bin/env python3
"""Safely select a clean stackchan-super worktree and run host/device read-only --check.

Does not modify existing worktrees or tracked files. Creates one reusable detached
worktree only after interactive approval. Does not build, flash, reset, or merge.
"""
from __future__ import annotations

import datetime
import os
from pathlib import Path
import re
import subprocess
import sys

HOME = Path.home()
BASE = HOME / "Stackchan_Projects"
MAIN = BASE / "repository"
WORK = BASE / "work"
RUNS = BASE / "runs"
SCRIPT = HOME / "stackchan.sh"
SLOT = WORK / "diagnostic-baseline"
REF = "refs/heads/stackchan-super"


def emit(level: str, step: str, message: str) -> None:
    print(f"[{level}] STEP={step} {message}", flush=True)


def call(*argv: str, cwd: Path | None = None, timeout: int = 30) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            list(map(str, argv)), cwd=str(cwd) if cwd else None,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        emit("FATAL", "EXEC", f"COMMAND={argv[0]} REASON={type(error).__name__}")
        raise SystemExit(1)


def git(*args: str, cwd: Path = MAIN) -> str | None:
    result = call("git", "-C", str(cwd), *args)
    return result.stdout.strip() if result.returncode == 0 else None


def safe(line: str) -> str:
    line = re.sub(r"(?i)(password|token|secret|authorization|api[_-]?key|ssid)\s*[:=]\s*\S+", r"\1=[redacted]", line)
    return line[:550]


def worktree_entries() -> list[Path]:
    result = git("worktree", "list", "--porcelain")
    if result is None:
        emit("FATAL", "WORKTREE", "REASON=cannot_list_worktrees")
        raise SystemExit(1)
    entries = []
    for line in result.splitlines():
        if line.startswith("worktree "):
            entries.append(Path(line[len("worktree "):]).resolve())
    return entries


def clean_and_same_revision(path: Path, sha: str) -> bool:
    if not path.is_dir():
        return False
    actual = git("rev-parse", "HEAD", cwd=path)
    if actual != sha:
        return False
    status = git("status", "--porcelain=v1", "--untracked-files=normal", cwd=path)
    if status is None or status:
        return False
    return (path / "AGENTS.md").is_file() and (path / "firmware").is_dir()


def preflight(path: Path, sha: str) -> int:
    emit("CHECK", "TARGET", f"REPO={path} SHA={sha} CLEAN=true")
    RUNS.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    logfile = RUNS / f"preflight-readonly-{stamp}-{os.getpid()}.log"
    emit("ACTION", "PREFLIGHT", "CMD=bash ~/stackchan.sh --check --repo <verified-clean-worktree>")
    try:
        result = subprocess.run(
            ["bash", str(SCRIPT), "--check", "--repo", str(path)],
            capture_output=True, text=True, timeout=150, check=False,
        )
    except subprocess.TimeoutExpired as error:
        data = (error.stdout or b"")
        if isinstance(data, bytes): data = data.decode(errors="replace")
        logfile.write_text(str(data))
        os.chmod(logfile, 0o600)
        emit("FATAL", "PREFLIGHT", f"REASON=timeout LOG={logfile}")
        return 1
    except OSError as error:
        emit("FATAL", "PREFLIGHT", f"REASON={type(error).__name__}")
        return 1
    output = result.stdout + ("\n" if result.stdout and result.stderr else "") + result.stderr
    logfile.write_text(output)
    os.chmod(logfile, 0o600)
    lines = output.splitlines()
    if result.returncode == 0:
        emit("INFO", "PREFLIGHT", "RESULT=pass")
        for line in lines:
            if any(k in line for k in ("HOST=", "WORKTREE_BRANCH=", "USB=", "LAST_FLASH_BOOT=", "HUB.", "PASS STEP=")):
                print(safe(line))
    else:
        emit("ERROR", "PREFLIGHT", f"RESULT=fail EXIT={result.returncode} REASON=inspect_saved_log")
        for line in lines[-35:]:
            print(safe(line))
    emit("INFO", "LOG", f"FILE={logfile}")
    return result.returncode


def main() -> int:
    emit("CHECK", "PREFLIGHT", "MODE=clean-source-selection NO_FLASH=true")
    if not SCRIPT.is_file() or not MAIN.is_dir() or not WORK.is_dir():
        emit("FATAL", "PATH", "REASON=expected_paths_missing")
        return 1
    if git("rev-parse", "--is-inside-work-tree") != "true":
        emit("FATAL", "MAIN", "REASON=not_a_git_repository")
        return 1
    sha = git("rev-parse", "--verify", f"{REF}^{{commit}}")
    if not sha or not re.fullmatch(r"[0-9a-f]{40}", sha):
        emit("FATAL", "REF", "REASON=local_stackchan_super_not_found")
        return 1
    emit("INFO", "REF", f"BASE={REF} SHA={sha}")
    registered = worktree_entries()
    emit("INFO", "WORKTREE", f"REGISTERED_COUNT={len(registered)}")
    root = WORK.resolve()

    def within_work(path: Path) -> bool:
        return path != root and root in path.parents

    chosen = next((path for path in registered if within_work(path) and clean_and_same_revision(path, sha)), None)
    if chosen:
        emit("INFO", "SELECT", f"REUSE_EXISTING={chosen}")
    else:
        chosen = SLOT.resolve()
        if SLOT.exists() or SLOT.is_symlink() or chosen in registered:
            if not (chosen in registered and clean_and_same_revision(chosen, sha)):
                emit("FATAL", "SELECT", f"REASON=reserved_diagnostic_path_not_clean_or_wrong_commit PATH={chosen}")
                return 1
            emit("INFO", "SELECT", f"REUSE_DEDICATED={chosen}")
        else:
            emit("CHECK", "CREATE", f"NEW_WORKTREE={chosen} BASE_SHA={sha}")
            if not sys.stdin.isatty():
                emit("FATAL", "APPROVAL", "REASON=interactive_terminal_required")
                return 1
            answer = input("[CHECK] Clean detached worktreeを1つ作成しますか？ [yes/no] ").strip()
            if answer != "yes":
                emit("WARN", "APPROVAL", "REASON=not_approved NO_CHANGES=true")
                return 1
            result = call("git", "-C", str(MAIN), "worktree", "add", "--detach", str(chosen), sha, timeout=90)
            if result.returncode:
                emit("FATAL", "CREATE", f"EXIT={result.returncode} REASON={safe(result.stderr.strip())}")
                return 1
            emit("INFO", "CREATE", f"RESULT=success PATH={chosen}")
    if not clean_and_same_revision(chosen, sha):
        emit("FATAL", "VALIDATE", "REASON=selected_worktree_not_clean_or_SHA_mismatch")
        return 1
    return preflight(chosen, sha)


if __name__ == "__main__":
    raise SystemExit(main())
