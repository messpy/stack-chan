# kmac Issue consumers

These host-only Python tools are now proposed as tracked source under `tools/kmac/`.
The installed copies live in `/home/kmac/Stackchan_Projects/tools/`; they were not
tracked in the firmware repository. The original allowlist distribution was
Issue #111 comment 6793269144. An existing untracked implementation in
`work/issue111-authenticated-approval/tools/kmac/` supplied the identity and
queue changes; this PR adds nonce binding, build approval, dispatch validation,
and tests without overwriting that working directory or the installed tools.

## Approval protocol

The allowlist worker accepts `check` and `logs` without approval. `build` and
`all` require explicit approval; old queued unapproved build tasks are migrated
to pending. Local interactive `--approve REQUEST_ID` remains supported.

After reviewed installation, run the allowlist worker with `--prepare-approvals`
to prepare challenges for existing pending requests. This takes its usual flock,
saves a random per-request nonce, and prints request/action/PR/nonce only. It
never fetches commands, approves tasks, or invokes the reporter. The nonce is a
public binding challenge, not a credential. `--status` stays read-only.

The allowlisted owner must post a **new, unedited** comment on Issue #111:

```text
STACKCHAN_APPROVAL_V1
{"request_id":"EXISTING_REQUEST_ID","action":"all","pr":102,"nonce":"32_LOWERCASE_HEX_FROM_PREPARATION","expires_at":"UTC_ISO_TIMESTAMP"}
```

Use a future UTC expiry at most 15 minutes after comment creation. Do not copy
the example literally. The request must already exist before the polling batch;
request ID, PR, action and nonce must match exactly. Duplicate fields are rejected.
The worker re-fetches the immutable comment ID through `gh api` and verifies
repository/issue, account login, stable numeric owner ID, account type and owner
association. Missing metadata, edits, API failures, expired or reused approval
IDs fail closed. Dispatch rechecks the approval and expiry before invoking the
fixed reporter. Invalid dispatch approval rotates the nonce and returns the
request to pending; consumed comment IDs remain consumed. A fresh owner action
is necessary. The `started` state is durable before the reporter starts.

The shell worker uses the same identity verifier before its existing explicit
`STACKCHAN_SHELL_V1` protocol and persists request IDs before execution to prevent
replay across distinct comments. It ignores approval messages and ordinary Issue
text. It still represents owner-authorized remote shell access as documented in
its module header; this change does not introduce a new shell protocol.

## Verification and rollout

```bash
python3 -m unittest discover -s tools/kmac -p 'test_*.py' -v
python3 tools/kmac/stackchan-issue-shell-agent.py --selftest
python3 -m py_compile tools/kmac/*.py
```

Tests isolate state and mock GitHub, reporter and command execution. The lock test
uses a real competing process. No firmware build, USB operation or device write
is needed. The existing reporter and `/home/kmac/stackchan.sh` are unchanged:
flock, USB identity, 16MiB backup, SHA256, dirty worktree and boot verification
remain their responsibility and are not bypassed by this protocol.

Installed scripts changed independently during implementation, so this PR does
not deploy over them or restart timers. Before rollout, stop polling at an idle
boundary, acquire the existing worker locks, back up and compare the current
installed scripts, reconcile concurrent edits, and deploy both workers plus
`stackchan_issue_auth.py` as a consistent set. Preserve state/cursors/request IDs.
Do not invoke `--install` (it bootstraps a cursor). Release locks and resume only
after review. Do not approve either pending `all` request as part of installation.

At inspection two PR #102 `all` requests were pending: comment 6811844059
(`stackchan-pr102-p0-build-flash-owner-approved-20261112-1038-v1`) and 6816031657
(`stackchan-pr102-build-flash-boot-20261112-v1`). They can be migrated without
re-enqueueing or approval. Build success is not evidence of successful flashing
or boot. Miniapp registration/display, official face/voice/camera and ntfy receipt
remain separate WBS1–2 work; this PR makes no hardware completion claim.

Release impact: none for firmware. These are host operational tools; no firmware
release note or changeset is required.
