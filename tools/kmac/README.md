# kmac Issue approval agents

These tracked files are the source of truth for the previously local-only agents
in `/home/kmac/Stackchan_Projects/tools/`. They were imported from the kmac host
on 2026-11-12 for Issue #111. The existing checkout's unrelated uncommitted edits
are excluded. No firmware code or release artifact changes (release impact: none).

`stackchan-issue-agent.py` owns fixed reporter actions and the local approval
queue. `stackchan-issue-shell-agent.py` is a separate, pre-existing remote shell
consumer: it is privileged as the kmac user and should only run when that remote
shell capability is intended. Approval messages never go to that interpreter.
Both consumers now re-fetch comment ids and require the pinned GitHub account id,
login, User type, OWNER association, exact repository/Issue and an unedited body.
An API failure denies the message; the advanced cursor prevents later replay.
Submit a new comment id after a failed lookup, with a fresh expiry.

## Explicit approval protocol

An owner must independently post a comment to Issue #111 starting with
`STACKCHAN_APPROVAL_V1` followed by a newline and a JSON object containing exactly:
`request_id`, `action` (`all`), `pr` (102), and `expires_at` (UTC ISO timestamp).
Expiry must be after now and at most 15 minutes after the comment creation time.
This document deliberately contains no ready-to-post approval for the pending
hardware request. Do not post an approval during implementation or tests.

Only one request that existed before the current poll can be approved; request
id, action and PR must match the pending entry exactly. The approval comment id
must follow the original command id. Edited comments, extra/duplicate JSON keys,
unknown requests and already consumed approvals are rejected. The cursor and
approval ids are persisted before execution under the existing shared flock.
An approval that expires while waiting is terminal (`approval_expired`); local
`--approve` is preserved for requests still in `approval_required` status.
At-most-once execution persists `started` before launching the fixed reporter.
A crash after reservation needs manual investigation, never automatic replay.

## Host integration and gates

Copy the two agents and `stackchan_issue_auth.py` together into the existing
local tools directory while holding both consumer locks. No timer installation,
bootstrap, live poll, approval or hardware operation is needed to update code.
The existing state files and service units remain in place. Do not reset cursors.
The shell consumer migrates historical request ids and reserves new ids durably.

The existing CLI `/home/kmac/stackchan.sh` is a symlink to
`Stackchan_Projects/scripts/stackchan.sh`, not a tracked repository file. Its
parser already provides `--PR`, `--sha`, `--all`, and `--yes`; no CLI flag or code
change is needed for approval ingestion. The reporter remains fixed to PR 102.
The reporter, CLI and unit files are host-managed dependencies, not new copies
in this PR. The installed reporter continues through existing USB identity,
16 MiB backup length, SHA256, dirty worktree, flock and boot checks. None is
bypassed by this change. This test suite never calls the reporter or hardware.

Run: `python3 -m unittest discover -s tools/kmac -p 'test_*.py' -v`.

WBS1–2 (miniapp registration/display, official face/voice/camera and ntfy receipt)
remain separate acceptance work. Approval tests do not prove firmware build,
boot, display, camera, voice or hardware acceptance. No hardware success is claimed.
