#!/usr/bin/env python3
"""Allowlisted StackChan commands from a dedicated GitHub issue.

GitHub issue comments are never interpreted as shell. Runs only the
installed ~/Stackchan_Projects/tools/stackchan-report.sh with a fixed mode.
"""

import argparse
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from stackchan_issue_auth import timestamp, verified_comment
from pathlib import Path

REPO = "messpy/stack-chan"
OWNER = "messpy"
INBOX_ISSUE = 111
FIXED_PR = 102  # The installed stackchan-report.sh currently hard-codes PR #102.
ROOT = Path.home() / "Stackchan_Projects"
RUNS = ROOT / "runs"
STATE_PATH = RUNS / "issue-agent-state.json"
LOCK_PATH = RUNS / "issue-agent.lock"
REPORTER = ROOT / "tools" / "stackchan-report.sh"
ACTIONS = {"check": 300, "logs": 600, "build": 7200, "all": 10800}
APPROVAL_PREFIX = "STACKCHAN_APPROVAL_V1\n"
COMMAND_PREFIX = "STACKCHAN_COMMAND_V1\n"
ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{2,63}\Z")


def info(level, step, message):
    print(f"[{level}] STEP={step} {message}", flush=True)


def fatal(step, message):
    info("FATAL", step, message)
    raise SystemExit(1)


def load_state():
    if not STATE_PATH.exists():
        return None
    try:
        value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if (not isinstance(value, dict) or type(value.get("seen_until")) is not int
                or not isinstance(value.get("queue"), list)
                or not isinstance(value.get("request_ids"), list)):
            raise ValueError("Invalid state structure")
        return value
    except (OSError, ValueError) as exc:
        fatal("STATE", f"state invalid; refusing to replay: {type(exc).__name__}")


def save_state(state):
    fd, temp_name = tempfile.mkstemp(prefix=".issue-agent-", dir=RUNS)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            os.fchmod(f.fileno(), 0o600)
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_name, STATE_PATH)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def get_lock():
    RUNS.mkdir(parents=True, exist_ok=True)
    fd = os.open(LOCK_PATH, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        info("INFO", "LOCK", "another invocation is running; skipped")
        os.close(fd)
        raise SystemExit(0)
    return fd


def fetch_comments():
    # Public repo API; credentials remain managed by gh, never passed in argv.
    endpoint = f"repos/{REPO}/issues/{INBOX_ISSUE}/comments?per_page=100"
    try:
        p = subprocess.run(
            ["gh", "api", "--paginate", endpoint],
            capture_output=True, text=True, timeout=60, check=True,
        )
        decoder = json.JSONDecoder()
        result = []
        pos = 0

        while pos < len(p.stdout):
            while pos < len(p.stdout) and p.stdout[pos].isspace():
                pos += 1

            if pos == len(p.stdout):
                break

            page, pos = decoder.raw_decode(p.stdout, pos)

            if not isinstance(page, list):
                raise ValueError("Unexpected page shape")

            result.extend(page)

        return sorted(result, key=lambda x: int(x["id"]))
    except (FileNotFoundError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        fatal("FETCH", f"GitHub Issue fetch failed: {type(exc).__name__}")


def parse_command(comment):
    if comment.get("user", {}).get("login") != OWNER:
        return None
    body = comment.get("body")
    if not isinstance(body, str) or len(body) > 2048 or not body.startswith(COMMAND_PREFIX):
        return None
    payload = body[len(COMMAND_PREFIX):].strip()
    if "\n" in payload:
        return None
    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict) or set(data) != {"request_id", "action", "pr"}:
        return None
    if type(data["request_id"]) is not str or not ID_PATTERN.fullmatch(data["request_id"]):
        return None
    if type(data["action"]) is not str or data["action"] not in ACTIONS:
        return None
    if type(data["pr"]) is not int or data["pr"] != FIXED_PR:
        return None
    return data


def parse_approval(comment):
    body = comment.get("body")
    if not isinstance(body, str) or len(body) > 2048 or not body.startswith(APPROVAL_PREFIX):
        return None
    try:
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate key")
                result[key] = value
            return result
        data = json.loads(body[len(APPROVAL_PREFIX):], object_pairs_hook=unique)
        if (not isinstance(data, dict)
                or set(data) != {"request_id", "action", "pr", "expires_at"}
                or type(data["request_id"]) is not str
                or not ID_PATTERN.fullmatch(data["request_id"])
                or data["action"] != "all" or type(data["pr"]) is not int
                or data["pr"] != FIXED_PR):
            return None
        expiry = timestamp(data["expires_at"])
        fresh = verified_comment(comment)
        if fresh is None:
            return None
        created = timestamp(fresh["created_at"])
        now = datetime.now(timezone.utc)
        if not (created <= now < expiry) or not 0 < (expiry - created).total_seconds() <= 900:
            return None
        return data
    except (ValueError, TypeError, KeyError):
        return None


def apply_approval(state, comment, preexisting):
    data = parse_approval(comment)
    if data is None or data["request_id"] not in preexisting:
        return False
    matches = [t for t in state["queue"] if t["request_id"] == data["request_id"]]
    if len(matches) != 1:
        return False
    task = matches[0]
    cid = comment["id"]
    if (task["status"] != "approval_required" or task["action"] != data["action"]
            or task["pr"] != data["pr"] or type(task.get("comment_id")) is not int
            or cid <= task["comment_id"] or task.get("approval_comment_id") is not None
            or cid in state.get("approval_comment_ids", [])):
        return False
    # Persisted by enqueue before dispatch, under the same flock as local --approve.
    state.setdefault("approval_comment_ids", []).append(cid)
    task.update(status="queued", approval_comment_id=cid,
                approval_expires_at=data["expires_at"],
                approved_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    info("INFO", "APPROVAL", f"authenticated approval recorded comment_id={cid}")
    return True


def enqueue(state, comments):
    added = 0
    preexisting = set(state["request_ids"])
    for comment in comments:
        comment_id = int(comment["id"])
        if comment_id <= state["seen_until"]:
            continue
        # Cursor advances even for invalid/non-owner comments; never revisit them.
        state["seen_until"] = comment_id
        if isinstance(comment.get("body"), str) and comment["body"].startswith(APPROVAL_PREFIX):
            apply_approval(state, comment, preexisting)
            continue
        cmd = parse_command(comment)
        if cmd is not None and verified_comment(comment) is None:
            cmd = None
        if cmd is None:
            continue
        if cmd["request_id"] in state["request_ids"]:
            info("WARN", "DUPLICATE", f"request_id={cmd['request_id']} ignored")
            continue
        if len(state["queue"]) >= 100:
            info("ERROR", "QUEUE", "queue full; ignoring additional commands")
            continue
        state["request_ids"].append(cmd["request_id"])
        state["queue"].append({
            "comment_id": comment_id,
            "request_id": cmd["request_id"],
            "action": cmd["action"],
            "pr": FIXED_PR,
            "status": "approval_required" if cmd["action"] == "all" else "queued",
        })
        info("INFO", "RECEIVE", f"id={cmd['request_id']} action={cmd['action']}")
        added += 1
    # Persist the cursor and queue before executing anything.
    save_state(state)
    return added


def execute(state, task):
    if task.get("approval_expires_at"):
        try:
            valid = datetime.now(timezone.utc) < timestamp(task["approval_expires_at"])
        except (ValueError, TypeError):
            valid = False
        if not valid:
            task["status"] = "approval_expired"
            save_state(state)
            info("WARN", "APPROVAL", "approval expired before dispatch; no execution")
            return
    action = task["action"]
    req = task["request_id"]
    task["status"] = "started"  # At-most-once: do not retry on crash/reboot.
    task["started_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save_state(state)
    local_log = RUNS / f"issue-agent-{task['comment_id']}-{req}.log"
    cmd = ["bash", str(REPORTER), "--" + action]
    info("ACTION", "EXECUTE", f"id={req} action={action} local_log={local_log.name}")
    rc = 1
    with local_log.open("w", encoding="utf-8") as handle:
        try:
            proc = subprocess.Popen(cmd, stdout=handle, stderr=subprocess.STDOUT,
                                    start_new_session=True)
            try:
                rc = proc.wait(timeout=ACTIONS[action])
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                rc = 124
                info("ERROR", "TIMEOUT", f"id={req} action={action}")
        except OSError as exc:
            # Do not expose untrusted output or environment variables.
            info("ERROR", "EXECUTE", f"id={req} {type(exc).__name__}")
    task["status"] = "completed" if rc == 0 else "failed"
    task["return_code"] = rc
    task["finished_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    task["local_log"] = local_log.name
    save_state(state)
    info("INFO" if rc == 0 else "ERROR", "RESULT", f"id={req} action={action} rc={rc}")


def poll():
    comments = fetch_comments()
    state = load_state()
    if state is None:
        # Never execute pre-install comments. This also prevents replay on first run.
        last = max((int(c["id"]) for c in comments), default=0)
        state = {"seen_until": last, "queue": [], "request_ids": []}
        save_state(state)
        info("INFO", "BOOTSTRAP", f"initialized at comment_id={last}; no old command executed")
        return
    enqueue(state, comments)
    task = next((t for t in state["queue"] if t["status"] == "queued"), None)
    if task:
        execute(state, task)
    else:
        waiting = sum(t["status"] == "approval_required" for t in state["queue"])
        info("INFO", "IDLE", f"no runnable command; awaiting_local_approval={waiting}")


def approve(request_id):
    if not sys.stdin.isatty():
        fatal("APPROVAL", "interactive terminal required")
    state = load_state()
    if state is None:
        fatal("APPROVAL", "agent not initialized; run --poll first")
    task = next((t for t in state["queue"] if t["request_id"] == request_id), None)
    if not task or task["action"] != "all" or task["status"] != "approval_required":
        fatal("APPROVAL", "no pending flash request with that ID")
    print(f"[WARN] PR #{FIXED_PR} firmware build / backup / flash / boot requested, id={request_id}")
    answer = input("実機書き込みを承認しますか？ [yes/no]: ").strip()
    if answer != "yes":
        info("INFO", "APPROVAL", "not approved")
        return
    task["status"] = "queued"
    task["approved_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    save_state(state)
    info("INFO", "APPROVAL", "approved; will run on next timer poll")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--poll", action="store_true", help="read Issue #111 and execute one safe command")
    group.add_argument("--approve", metavar="REQUEST_ID", help="locally approve a pending --all operation")
    group.add_argument("--status", action="store_true", help="show local state without touching GitHub")
    args = parser.parse_args()
    lock_fd = get_lock()
    try:
        if args.poll:
            poll()
        elif args.approve:
            approve(args.approve)
        else:
            state = load_state()
            if state is None:
                info("INFO", "STATUS", "uninitialized")
            else:
                info("INFO", "STATUS", f"seen_until={state['seen_until']}")
                for task in state["queue"][-20:]:
                    info("INFO", "TASK", f"id={task['request_id']} action={task['action']} status={task['status']}")
    finally:
        os.close(lock_fd)


if __name__ == "__main__":
    main()
