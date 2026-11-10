# CoreS3 camera and USB investigation — 2026-11-08

Release impact: patch. Draft PR #58 remains the sole integration point. No merge,
flash, reboot, service restart, SD access or photo was performed during this investigation.
The user powered the board on at approximately 17:51 JST.

## Evidence and limits (JST)

| Subject | Observation | Interpretation |
| --- | --- | --- |
| Host | Boot 2026-11-07 17:24:34; uptime 22h47 at 16:12 | No host reboot at the reported USB incident |
| USB | 14:59:15: `usb 1-1: USB disconnect, device number 15`; no reconnection until 17:51:07 | Real host-side removal, not merely a renamed tty |
| Identity | VID/PID 303a:1001, serial 44:1B:F6:DF:5A:D0, physical path 1-1 | Same identity returned at 17:51:07 after user power-on |
| Renumbering | 08:42:52: same serial became ttyACM1; 08:45:19 ttyACM0 | Fixed ttyACM0 is not a reliable identity |
| SSH | 16:07:21: client-requested disconnect; new login 16:07:28 | This disconnect is 68m06s after USB loss; no evidence for one common failure. Earlier unrecorded SSH events cannot be inferred |
| Hub | Unit file: Restart=on-failure, RestartSec=5, KillMode=process | Explicit stop/clean exit is not automatically restarted. Current ActiveState/Result/ExecMainStatus unavailable: sandbox rejects user-bus access; no matching unit journal entries were available |
| Ports/processes | No visible /dev/ttyACM*, by-id or by-path in execution sandbox; tmux socket access denied | After 17:51, sysfs and kernel show ttyACM0 while sandbox /dev does not. Do not equate sandbox invisibility with renewed physical loss; cannot verify serial ownership/communication here |
| Logs | No /tmp/stackchan-camera-once-*.log; existing 11:27 log ends in /photo timeout | Newer shot initiation is unproven. Absence of log cannot establish why a shell/command exited |
| Flash backup | 12:54 backup: 16,777,216 bytes, existing SHA256 verification passed | Historical full-flash rollback artifact; a fresh pre-flash backup is still required |
| SD | No reads/writes/scans performed; separate backup not verified | JPEG existence, integrity, free space and card health remain unknown |

No overcurrent, enumeration failure, or USB driver error accompanied the 14:59
removal in the inspected kernel events. Cable, power loss and firmware/peripheral
state remain hypotheses. Power-on restoring enumeration does not identify which
caused the earlier disappearance.

## Camera analysis

The 11:27 pre-shot sample reported internalFree=143207, internalLargest=69632,
psramFree=6697304 bytes, followed by RAM_READY. This exceeds the admission policy
(96 KiB internal free, 30 KiB contiguous, 1 MiB PSRAM). It does not measure peak
JPEG/driver allocation or exclude later allocation failure.

The prior RTC stage 14 (CAMERA_SAVE) and last drained USB line (native start done)
are different observations. The release debug log uses a finite RAM ring drained
by a JS timer; synchronous work can advance RTC while preventing USB draining.
Stage 14 is reached after save() returns (file write, flush, close). It is not an
independent JPEG readback/integrity check. The previously deployed stage mapping
also lacked the finer post-save checkpoints. No newer shot/reset is established.

A concrete SDK defect was identified: cameraLoop reads task notifications only
when idle or not running. In continuous capture, stop/close notifications remain
unconsumed, while destructor waits for termination. stop() previously returned
DMA frames without confirming producer quiescence. This is reproducible under
host RTOS/driver stubs using the actual SDK loop, not proof of the exact prior
hardware stall. The same tests fail with the original SDK (negative control).

The build-time known-layout patch now consumes control during running capture,
acknowledges stop before recycling frames, and handles a null driver frame on
timeout. Unknown SDK layouts abort without modifying the SDK. Preserve existing
camera.c.stackchan-original; already-buffer-patched SDKs can upgrade safely.
The native watchdog remains necessary if the driver itself or scheduler stalls.

The JPEG native binding copies encoder output into its own ArrayBuffer before
freeing the encoder allocation. Therefore still-photo code can release its DMA
frame, stop and close the camera, and restore touch before SD save. RTC stage
numbers 16–25 remain unchanged; CAMERA_SAVE now follows CAMERA_CLOSED. Native
release failure is attempted once, quarantines voice reconnection and leaves the
watchdog armed. JPEG/SD errors still release resources and close open files.
Face rendering and existing conversation-history behavior remain unchanged.

## Diagnostic operation

Use `python3 scripts/camera-probe-session.py` (or `bash scripts/stackchan-ci.sh camera`).
It creates a private unique log under firmware/dist/camera-logs **before** discovery
or confirmation, records UTC start, source SHA/dirty flag, host binary SHA256,
USB identity and initial hub state. Installed firmware build ID is explicitly
reported unavailable: a host binary hash is not an installed-build attestation.
A yes/no prompt authorizes one /photo request with analyze=false, default AI OFF.
The worker verifies the recorded identity again and holds a host session lock.

A transient user service runs the worker independently of SSH. The attached
launcher waits and displays the log tail on failure; Ctrl+C stops its own unit.
SSH loss leaves the worker running with file output. RuntimeMaxSec=150 bounds a
stuck worker; ExecStopPost restores the hub only if originally active, including
worker crash/SIGKILL. An inactive/failed hub stays stopped. User-manager failure,
host power loss and failed service restoration remain visible failure cases,
not guarantees of recovery. Inspect `journalctl --user -u <logged-unit>` if needed.

Transport loss/timeout never resends /photo. For at most 75 seconds it verifies
VID/PID plus serial (or physical location when no serial) and issues only
/debug/status. BEFORE versus recovery RTC values are logged; old watchdog flags
are not attributed automatically to the new attempt. No raw debug text,
conversation bodies, credentials, provider configuration or arbitrary firmware
error messages are echoed. USB transmission uses write_timeout without tcdrain.

/debug/status uses cached settings, runtime voice flags and heap measurements;
it never initializes SD settings, queries speaker SQLite, lists files or mounts
SD. /status still checks SD and can block. Neither RPC lane can run while XS is
blocked synchronously; use RTC plus the independent native watchdog in that case.
/files remains an unbounded compatibility endpoint and can exceed the native USB
packet limit. /files/page bounds each response but offset pagination can revisit
the prefix of a directory; do not repeatedly enumerate a problematic card.
The probe calls neither listing endpoint nor /status.

## Validation and acceptance

Targeted checks: photo fault injection (8), runtime camera lifecycle (11), archive
lifecycle (11), SD-independent diagnostic behavior (2), USB RPC/memory policy (8),
SDK transform/backup (4), compiled actual native loop (4), supervisor/protocol (6):
54 passed, 0 failed. Native loop cases cover running stop/close, driver null-frame
and init failure. Protocol tests cover one send, last stage, identity changes,
read-only recovery, collision-free logs and previous service-state restoration.
Service lifecycle and actual USB reconnection are mocked, not hardware tests.

Broad suites were also attempted: test:unit reported 101/105 files passing, and
initial archive run 38/42. Failures include subprocess-launch restrictions,
missing sibling hub in the isolated checkout (resolved with read-only symlink),
and existing offline/speaker fixture failures. Offline and speaker failures were
reproduced unchanged at original HEAD 3536d92c. These broad suites are not claimed
as passing. See dist/review-logs; follow-up work should repair existing test
fixtures and rerun subprocess tests in an unrestricted CI runner.

Build uses ESP-IDF 6.1 and an isolated copy of the installed Moddable SDK, preserving
the shared SDK/worktree. First build failed on registry network access; cached
managed_components and dependencies.lock were copied from the existing successful
build. A disabled-manager experiment failed dependency resolution, and a partial
CMake cache failed xs_.a resolution. Preserve failed build output; fresh generated
build directory succeeded at 17:57:27. Final incremental build succeeded at 17:58:20 (exit 0); log:
`dist/update-logs/20261108-175742-7.log`. Status is recorded in
`dist/update-logs/latest.json`. No deploy command was used.

Hardware acceptance remains blocked until SD backup is verified, a stable same-board
USB connection is accessible to the executor, and a fresh 16MiB backup is made.
Then obtain explicit yes/no approval for the concrete built binary before flash;
verify boot/face/touch and debug status, then separately approve one photo. Validate
new JPEG readability and voice reconnection without repeating a failed shot.
