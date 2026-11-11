# StackChan read-only diagnosis — 2026-11-11

Scope: evidence capture and causal triage only. **Do not merge, flash, reset, clean, stash, remove worktrees, or modify local settings based solely on this report.**

## Observations supplied from kmac

- Home management entrypoint: `~/stackchan.sh --check`.
- Local main repo: `/home/kmac/Stackchan_Projects/repository`, branch `test/pr-integration-20261104`; 10 tracked modified files and 4 untracked files (all must remain intact).
- Several other worktrees exist, including detached ones; detached status alone is not a defect.
- `git cat-file -t fcb159f7a05f` in main repo: `Not a valid object name`.
- Local `~/stackchan.sh` output/grep indicates `--repo` defaults to `DEFAULT_REPO`, with help text referencing `stackchan-context-recovery-20261109` (line 886 in local script), and preflight checks tracked changes through `self.repo`.
- Local execution previously reported `feat/audio-diagnostics-20261110` / `fcb159f7a05f`, with `tracked changes exist`; this did **not** come from the currently inspected main repo branch.
- Last flash receipt: `11f9feb45fcda1ebbfd8d0d5dc27fb65d90a28e8` (`detached`), image SHA256 `29a06a363d8cf77bb64055743d6cdc743f743dcdaf22d74a497ef48269f2582b`, boot `not-verified`; this is a host receipt, not a live flash readback.
- Historical boot evidence: `ESP-ROM:esp32s3-20210327`, `rst:0x15 (USB_UART_CHIP_RESET)`, `patched CoreS3 AXP2101 power rails`, `No Wi-Fi SSID`, `[startup-checkpoint] step=main-entry state=begin`; no confirmed `[main] start` after that. Neither SSID line nor USB reset proves the immediate startup cause.

## GitHub-side read-only findings (verified)

- Remote `stackchan-super` HEAD at time of check: `4638143aa9dafc4ae6708f9d301af9ef79324536`.
- Remote tracked `firmware/scripts/stackchan.sh` on `stackchan-super` has `DEFAULT_REPO = HOME / 'work/stackchan-context-recovery-20261109'` (line 8), `self.repo = pathlib.Path(args.repo).resolve()` (line 59), and `git status --porcelain --untracked-files=no` in its preflight (line 221). Its `--repo` CLI default points to `DEFAULT_REPO` (line 697).
- The remote tracked script also includes stale `HOME / 'work/...'` SDK and test-helper paths and a legacy `PRIVATE` manifest path. **Do not assume local `~/stackchan.sh` matches this remote version:** local help line is 886 rather than remote 697, so versions appear different.
- GitHub commit lookup for `fcb159f7a05f` returned 422 / `No commit found for SHA`.
- PR #107 and PR #109 are open Drafts, unmerged. PR #109 CI failed at architecture validation: 72/76 pass, 4 fail (font glyph expectation; relative imports; inline async IIFE; spread in servo driver). This is not evidence of a hardware boot fault.

## Working hypothesis, not yet a proven local-file fact

The preflight is running against an obsolete, dirty worktree due to the CLI default repo path, independent from the newly organized main repo. A different/older local `~/stackchan.sh` copy may also be involved. The precise resolved local `DEFAULT_REPO` and CLI flags are the narrow remaining confirmation targets.

## Four-layer fault classification

| Layer | Status | Reason |
|---|---|---|
| Toolchain/build | Partially verified; current reproducibility unconfirmed | Historic 629 passing tests/build; CI PR #109 failing architecture validation |
| Hardware/USB | Unconfirmed | USB disconnect/reconnect observed; not an isolation test |
| Git/runtime | Host-side repo-selection mismatch suspected; source inconsistencies confirmed | Local refs vs runner output mismatch; GitHub tracked script uses old paths |
| Settings/Wi-Fi/SD | Unconfirmed | `No Wi-Fi SSID` alone not causal |

## Next controlled steps

1. Inspect local installed `DEFAULT_REPO`, local CLI `--repo` handling, and exact actual path selected, without dumping private config or full script.
2. Select a clean dedicated testing worktree, keeping all 14 dirty/untracked files and other worktrees untouched.
3. Separate host preflight from device startup diagnosis; compare read-back flash and known-good image only after USB/device identity, complete 16 MiB backup, and SHA256 checks.
4. No repair PR, merge, local rewrite, or flash until causality is supported by evidence.

No private configuration, tokens, local full logs, or hardware serials are included in this report.

## kmac follow-up audit — confirmed 2026-11-11

The GitHub-authored `preflight_audit.py` was fetched and executed read-only on kmac. The user supplied its output:

- Installed `~/stackchan.sh`: SHA256 `3d7a6327c6e648e0759717a03c49d24337aa0481dc5563f692399be6f7b7a61c`, 69,625 bytes.
- Parser: `DEFAULT_REPO_LINE=10`, `DEFAULT_REPO=not_statically_resolvable`; `--repo` override exists; tracked-changes guard at local line 247.
- Main: `/home/kmac/Stackchan_Projects/repository`, branch `test/pr-integration-20261104`, HEAD `da8dbb48ca67aed6f8159ba01bea821e7538a7f5`, 10 tracked changes, `fcb159f7a05f` not present.
- Legacy candidate `/home/kmac/work/stackchan-context-recovery-20261109` resolves to `/home/kmac/Stackchan_Projects/work/stackchan-context-recovery-20261109`; branch `feat/audio-diagnostics-20261110`, HEAD `fcb159f7a05f4db0f08a76db7601bffdbcd8d0f4`, 1 tracked change, the commit exists locally there.
- Main enumerates 21 worktrees.

**Host-side conclusion:** The previous `--check` failure and branch/commit output match the legacy candidate, not the main repository. Stale/default repo selection is the leading cause of this *preflight* block; exact local `DEFAULT_REPO` expression was not statically resolved. It is now established that `fcb159f7a05f` exists in a different local Git object database, so the earlier 'not a valid object' result in the main repo did not mean that the commit was lost.

**Next action prepared on this same diagnosis branch:** `firmware/scripts/diagnostics/run_clean_preflight.py` searches for an already-clean same-SHA `stackchan-super` worktree, otherwise requests explicit interactive approval to create one reusable detached baseline. It runs only `bash ~/stackchan.sh --check --repo <verified worktree>`. It does not flash, build, reset, stash, clean, checkout existing worktrees, push, merge, or overwrite any source edits. It records and bounds failure logs.

Do not confuse successful host preflight with successful CoreS3 startup. USB checks can still fail, and device boot remains unverified.
