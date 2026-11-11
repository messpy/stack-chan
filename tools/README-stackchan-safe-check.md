# StackChan safe read-only checks (kmac)

`tools/stackchan-safe-check.py` calls the existing `~/stackchan.sh --check`
with an explicit clean PR #102 integration worktree. It never resets tracked
changes, checks out a branch, builds, flashes, or merges.

## Tests

```bash
python3 -m unittest discover -s tools -p 'test_stackchan_safe_check.py' -v
```

## Read-only check (kmac)

```bash
python3 tools/stackchan-safe-check.py
```

The helper returns the underlying `stackchan.sh --check` status; exits 2
if no clean, dependency-equipped integration worktree is available.
It never uses or overwrites the modified `repository/` checkout.

## Scheduling and reporting

The local `stackchan-health-monitor.timer` is configured for :00, :10, :20,
:30, :40 and :50 each hour using a kmac systemd user drop-in.
Each run performs local read-only checks and reports to GitHub Issue #110.
Issue #111 remains an explicit command queue. This PR does not automatically
execute or fix arbitrary code from public GitHub comments.

After reviewing this PR, update only the local `--check` dispatch in
`stackchan-report.sh` and `stackchan-health-monitor.py` to call this helper.
Back up both files and roll back on verification failure. Preserve the
existing build/flash gate, USB identity check, firmware backup and SHA256.

## PR-first changes

Use `stackchan-super` as the PR base. Do not automatically merge or flash.
Do not post private manifests, credentials or raw logs to public GitHub Issues.
