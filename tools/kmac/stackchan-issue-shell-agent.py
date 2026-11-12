#!/usr/bin/env python3
"""Owner-authenticated GitHub Issue #111 shell queue for kmac (user-level only).

Security boundary: comments authored by the configured GitHub owner on exactly
one issue. This is remote shell execution as the local account: only install
if you accept that account compromise may cause local code execution.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import subprocess
import sys
import tempfile
from stackchan_issue_auth import verified_comment

REPO = "messpy/stack-chan"
INBOX = 111
OUTBOX = 110
OWNER = "messpy"
HOST = "kmac"
MARKER = "STACKCHAN_SHELL_V1\n"
HOME = Path.home()
PROJECT = HOME / "Stackchan_Projects"
TOOL = PROJECT / "tools" / "stackchan-issue-shell-agent.py"
STATE_DIR = PROJECT / "runs" / "issue-shell-agent"
STATE = STATE_DIR / "state.json"
LOCK = STATE_DIR / "worker.lock"
LOGS = STATE_DIR / "logs"
MAX_COMMAND = 8192
MAX_TIMEOUT = 1800


def timestamp():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def error(step, message):
    print(f"[FATAL] STEP={step} REASON={message}", flush=True)
    return 1


def run_gh(args, stdin=None):
    return subprocess.run(
        ["gh", "api", *args], input=stdin, capture_output=True,
        text=True, timeout=90, check=True,
    ).stdout


def parse_pages(value):
    decoder = json.JSONDecoder()
    result = []
    pos = 0
    while True:
        while pos < len(value) and value[pos].isspace():
            pos += 1
        if pos >= len(value):
            break
        page, pos = decoder.raw_decode(value, pos)
        if not isinstance(page, list):
            raise ValueError("unexpected GitHub pagination response")
        result.extend(page)
    return result


def load_comments():
    response = run_gh(["--paginate", f"repos/{REPO}/issues/{INBOX}/comments?per_page=100"])
    if len(response) > 12_000_000:
        raise ValueError("GitHub response too large")
    return sorted(parse_pages(response), key=lambda c: int(c["id"]))


def save_state(cursor, request_ids=None):
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=STATE_DIR,
                                     prefix=".state-", delete=False) as f:
        os.chmod(f.name, 0o600)
        if request_ids is None:
            request_ids = get_request_ids()
        json.dump({"last_comment_id": cursor, "updated_at": timestamp(),
                   "request_ids": sorted(request_ids)}, f)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
        path = Path(f.name)
    os.replace(path, STATE)


def get_cursor():
    if not STATE.is_file():
        return None
    value = json.loads(STATE.read_text())
    return int(value["last_comment_id"])


def get_request_ids():
    if not STATE.is_file():
        return set()
    value = json.loads(STATE.read_text()).get("request_ids", [])
    if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
        raise ValueError("invalid request ids")
    return set(value)


def redact(line):
    if re.search(r"token|password|secret|authorization|bearer|credential|"
                 r"api[_-]?key|private[_-]?key|ssid|cookie|session", line, re.I):
        return "[REDACTED: sensitive keyword]"
    line = re.sub(r"https?://\S+", "[URL]", line)
    line = re.sub(r"/home/[^\s]+", "[LOCAL_PATH]", line)
    line = re.sub(r"\b[0-9A-Fa-f]{32,}\b", "[HASH]", line)
    line = re.sub(r"(?<!\w)[A-Za-z0-9_+/=-]{80,}(?!\w)", "[HIGH_ENTROPY_REDACTED]", line)
    return line[:180]


def diagnostic_lines(log):
    lines = []
    for line in log.splitlines():
        # Only predesignated diagnostic lines; no arbitrary stdout publication.
        if not re.match(r"^\[(?:CHECK|INFO|WARN|ERROR|FATAL)\] STEP=", line):
            continue
        lines.append(redact(line))
        if len(lines) >= 12:
            break
    return lines


def validate(comment):
    if comment.get("user", {}).get("login") != OWNER:
        return None
    body = comment.get("body") or ""
    if not body.startswith(MARKER):
        return None
    try:
        request = json.loads(body[len(MARKER):].strip())
    except (ValueError, TypeError):
        return {"error": "malformed JSON"}
    if not isinstance(request, dict):
        return {"error": "request must be JSON object"}
    if request.get("host") != HOST:
        return {"error": "wrong host"}
    rid = request.get("request_id")
    cmd = request.get("command")
    if not isinstance(rid, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,90}", rid):
        return {"error": "invalid request_id"}
    if not isinstance(cmd, str) or not cmd.strip() or len(cmd) > MAX_COMMAND or "\0" in cmd:
        return {"error": "invalid command"}
    timeout = request.get("timeout", 120)
    if type(timeout) is not int or not 1 <= timeout <= MAX_TIMEOUT:
        return {"error": "invalid timeout"}
    cwd = request.get("cwd", str(PROJECT))
    if not isinstance(cwd, str) or not cwd.startswith("/"):
        return {"error": "invalid cwd"}
    target = Path(cwd).resolve()
    if not (target == PROJECT or PROJECT in target.parents) or not target.is_dir():
        return {"error": "cwd outside project or missing"}
    return {"request_id": rid, "command": cmd, "timeout": timeout,
            "cwd": str(target), "publish_diagnostics": request.get("publish_diagnostics") is True}


def report(comment_id, rid, exit_code, classification, digest, snippet=()):
    uri = f"https://github.com/{REPO}/issues/{INBOX}#issuecomment-{comment_id}"
    lines = [
        "## StackChan Issue shell 実行レポート",
        f"- UTC: `{timestamp()}`",
        f"- Host: `{HOST}`",
        f"- Request: `{rid}`",
        f"- Command comment: {uri}",
        f"- Command SHA256: `{digest}`",
        f"- Status: **{classification}** (exit={exit_code})",
        "- Scope: kmac user account (not root)",
        "- Raw stdout/stderr: kmac only; not published",
    ]
    if snippet:
        lines.extend(["", "### Redacted diagnostic markers", "```text", *snippet, "```"])
    data = json.dumps({"body": "\n".join(lines)}, ensure_ascii=False)
    run_gh(["-X", "POST", f"repos/{REPO}/issues/{OUTBOX}/comments", "--input", "-"], stdin=data)


def execute(comment, request):
    cid = int(comment["id"])
    rid = request["request_id"]
    command = request["command"]
    digest = hashlib.sha256(command.encode()).hexdigest()
    LOGS.mkdir(parents=True, exist_ok=True, mode=0o700)
    log_path = LOGS / f"{cid}-{rid}.log"
    print(f"[ACTION] STEP=EXECUTE CID={cid} REQUEST={rid} SHA256={digest}", flush=True)
    env = {key: value for key, value in os.environ.items()
           if key not in ("GH_TOKEN", "GITHUB_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN", "SUDO_ASKPASS")}
    proc = subprocess.Popen(["/bin/bash", "-c", command], cwd=request["cwd"],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            stdin=subprocess.DEVNULL, start_new_session=True)
    try:
        stdout, stderr = proc.communicate(timeout=request["timeout"])
        code = proc.returncode
        status = "SUCCESS" if code == 0 else "FAILED"
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        stdout, stderr = proc.communicate()
        code = 124
        status = "TIMEOUT"
    output = stdout.decode(errors="replace") + "\n" + stderr.decode(errors="replace")
    log_path.write_text(output)
    log_path.chmod(0o600)
    snippets = diagnostic_lines(output) if request["publish_diagnostics"] else []
    report(cid, rid, code, status, digest, snippets)
    print(f"[INFO] STEP=RESULT STATUS={status} EXIT={code} LOG={log_path}", flush=True)


def once(init_only=False):
    if socket.gethostname().split(".")[0] != HOST:
        return error("HOST", "unexpected host")
    if os.geteuid() == 0:
        return error("USER", "must not run as root")
    if not shutil.which("gh"):
        return error("GH", "gh CLI missing")
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    with LOCK.open("a+") as lockfile:
        try:
            fcntl.flock(lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("[INFO] STEP=LOCK another run active")
            return 0
        try:
            comments = load_comments()
        except Exception as exc:
            return error("FETCH", type(exc).__name__)
        cursor = get_cursor()
        if cursor is None or init_only:
            high = max([int(c["id"]) for c in comments], default=0)
            save_state(max(high, cursor or 0))
            print(f"[INFO] STEP=INITIALIZE LAST_COMMENT={max(high, cursor or 0)}")
            return 0
        request_ids = get_request_ids()
        # Migrate the old cursor-only state without replaying historical requests.
        for old in comments:
            if int(old["id"]) <= cursor:
                parsed = validate(old)
                if parsed and "request_id" in parsed:
                    request_ids.add(parsed["request_id"])
        save_state(cursor, request_ids)
        for comment in comments:
            cid = int(comment["id"])
            if cid <= cursor:
                continue
            # At-most-once: persist the cursor before executing any command.
            save_state(cid)
            cursor = cid
            request = validate(comment)
            if request is None:
                continue
            if "error" in request:
                print(f"[WARN] STEP=REJECT CID={cid} REASON={request['error']}")
                continue
            if verified_comment(comment) is None:
                print(f"[WARN] STEP=AUTH CID={cid} owner identity unavailable or invalid")
                continue
            rid = request["request_id"]
            if rid in request_ids:
                print(f"[WARN] STEP=DUPLICATE CID={cid} request already seen")
                continue
            request_ids.add(rid)
            save_state(cid, request_ids)  # Reserve before subprocess; crash is not retried.
            try:
                execute(comment, request)
            except Exception as exc:
                # No automatic retry: even a partial command could be destructive.
                print(f"[ERROR] STEP=EXECUTE CID={cid} REASON={type(exc).__name__}", flush=True)
        return 0


def install():
    if socket.gethostname().split(".")[0] != HOST or os.geteuid() == 0:
        return error("INSTALL", "only unprivileged kmac account may install")
    if Path(__file__).resolve() != TOOL.resolve():
        return error("INSTALL", f"script must be at {TOOL}")
    status = once(init_only=True)
    if status:
        return status
    unit_dir = HOME / ".config" / "systemd" / "user"
    unit_dir.mkdir(parents=True, exist_ok=True)
    service = unit_dir / "stackchan-issue-shell-agent.service"
    timer = unit_dir / "stackchan-issue-shell-agent.timer"
    service.write_text(
        "[Unit]\nDescription=StackChan owner-authenticated Issue shell agent\n"
        "[Service]\nType=oneshot\nNoNewPrivileges=yes\nUMask=0077\n"
        f"ExecStart={shutil.which('python3')} {TOOL} --once\n"
    )
    timer.write_text(
        "[Unit]\nDescription=Poll StackChan shell Issue #111 every minute\n"
        "[Timer]\nOnBootSec=30s\nOnUnitActiveSec=60s\nAccuracySec=10s\n"
        "[Install]\nWantedBy=timers.target\n"
    )
    for cmd in (["systemctl", "--user", "daemon-reload"],
                ["systemctl", "--user", "enable", "--now", timer.name]):
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode:
            return error("INSTALL", f"systemd: {p.stderr.strip()[:150]}")
    print("[INFO] STEP=INSTALL SUCCESS")
    print("[INFO] STEPS=Issue#111 commands start AFTER bootstrap; prior comments ignored")
    return 0


def selftest():
    assert parse_pages('[{"id":1}][{"id":2}]') == [{"id":1}, {"id":2}]
    assert validate({"user":{"login":"attacker"},"body":MARKER+'{}'}) is None
    global PROJECT
    old_project = PROJECT
    with tempfile.TemporaryDirectory() as d:
        PROJECT = Path(d)
        x = {"user":{"login":OWNER},"body":MARKER+json.dumps({"request_id":"test_1", "host":HOST, "cwd":str(PROJECT), "command":"printf hi"})}
        assert validate(x) and validate(x)["command"] == "printf hi"
        assert not validate({**x,"body":MARKER+json.dumps({"request_id":"test_1","host":"wrong","command":"whoami"})}).get("command")
    PROJECT = old_project
    assert diagnostic_lines('[INFO] STEP=TEST value=ok\nsecret-value\n') == ['[INFO] STEP=TEST value=ok']
    print("[INFO] STEP=SELFTEST PASS=5")
    return 0


def main():
    if len(sys.argv) != 2:
        return error("ARGS", "use --install | --once | --selftest")
    action = sys.argv[1]
    if action == "--selftest":
        return selftest()
    if action == "--install":
        return install()
    if action == "--once":
        return once()
    return error("ARGS", "invalid action")


if __name__ == "__main__":
    sys.exit(main())
