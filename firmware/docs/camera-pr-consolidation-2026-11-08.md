# CoreS3 camera PR consolidation — 2026-11-08

## Decision

**Single camera integration target: Draft PR #58**, based on `stackchan-super`.
Do not merge #47, #55, #56, or #57 independently into `stackchan-super`.
This document maps functional changes, not GitHub merge history.
Until hardware acceptance is successful, all supersession is **code review / branch integration only**, not a confirmed fix.

## Cross-PR comparison

| Earlier PR | Camera-specific functionality | PR #58 equivalent | Outstanding |
| --- | --- | --- | --- |
| #47 | Positive local photo command in transcription, XiaoZhi STT and chat; `analyze:false`; SD-linked history | `archive-direct-photo.js`, `archive-direct-chat.js`, `lan-archive.js` | Three voice modes and negative examples require CoreS3 E2E |
| #55 | Close XiaoZhi session/Opus/TLS before photo; defer reconnect; typed camera errors and native close | `beginCameraHandoff/finishCameraHandoff`, `waitForCameraMemory`, `photoRecoveryWatchdog`, `cameraFailureClass`, safe camera close | Synchronous voice close may still hang; #55-specific LAN/VOICEVOX standalone scripts not independently cherry-picked |
| #56 | Opt-in volatile USB ASR/AI/camera logs; one-command device diagnostics | Integrated in PR #58 by ancestry (`compare: #56 is behind #58`) | Do not expose transcripts or credentials |
| #57 | Move 20,005-byte USB RX buffer from internal BSS to PSRAM | `archive-usb.c`, `archive-usb-psram.test.mjs` | Measure heap on real device, keep voice memory guard unchanged |
| #31 | Camera resource ownership and touch-pause; mixed with servo, voice tools, volume | Camera aspect implemented via `runtime-camera.ts`, frame release and close; other functionality **not** imported | Keep #31 separate for unrelated fixes |
| #39 | Photo capture diagnostics and CLI acceptance; mixed with boot, volume, servo, network | Photo stage, USB RPC and camera probe in #58 | Keep #39 separate; do not cherry-pick unrelated changes |
| #30 | Reject unsolicited AI camera requests; mixed with head motion/volume | Explicit photo authorization and cloud tool guard in #58 | #30 explicitly superseded by #31, not automatically merged here |

### Integration scope

- **In #58:** photo command authorization, safe audio/voice-to-camera handoff, temporary audio memory release, camera DMA lifecycle, JPEG conversion and SD save, privacy-preserving diagnostic stage/error code, independent native photo-recovery watchdog, PSRAM optimization and USB diagnostic route.
- **Not claimed solved:** native audio close hang, hardware image save integrity, AI reconnection reliability, conversation-memory continuity after a new cloud session, official face/touch regression.
- **Not in #58:** unrelated head servo, volume, sleep animation, offline speech engine, global AI mode persistence.
- **Conversation context after photo:** `conversationInstructions()` currently sends only recent 3 history messages when an identified speaker exists. A photo-specific continuation snapshot and resumable `pendingPhoto` context are **not yet implemented**; adding them must preserve no cloud image upload unless the user expressly requests analysis.
- **Acceptance:** Native CoreS3 compile, backup + authorized flash, one AI OFF capture with JPEG file verified, one AI ON voice capture + listening recovery, no unsolicited capture, privacy checks, no memory leak or watchdog reset. Keep #58 Draft until then.

## Historical hardware evidence

- `35dce92d` built and flashed on kmac. At `/status` immediately before a camera-probe invocation, `chat.state=listening` and 64,383 B internal free were observed. `/photo` timed out after 30s; last visible trace `[TouchPanel] start interval=50ms`. No visible `VOICE_RELEASE` marker. An actual AI-OFF photo test was **not performed** in that run.
- `da0eac3609b4fe369061a49b5434d3169cff8672` adds native watchdog coverage before voice teardown, RTC restart checkpoint and a probe preflight that rejects accidental AI-ON requests. kmac build succeeded, SHA256 `5b52c3a2119b9b16f87a9b9fde695ac17a5fb725983ef738c082f02e52de64f5`. No hardware flash/shot of that newer build confirmed yet.
- 2026-11-08 follow-up: consolidate the bounded command variants from #47/#55 and the sanitized failure classes from #55 in PR #58. These are regression-tested in GitHub Actions; physical validation remains required.

## Duplicate-PR handling

Use PR #58 as the sole camera feature/integration review. The original PRs remain visible as historical review/audit trails; close as **superseded** only after confirming no unique camera behavior has been dropped. Closing a PR is not merging it, and cannot substitute for a hardware acceptance test. Do not merge PR #58 until actual camera operation succeeds.
