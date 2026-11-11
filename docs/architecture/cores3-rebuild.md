# CoreS3 incremental rebuild architecture (Issue #108)

## Scope and immutable baseline
- Target: official M5StackChan CoreS3; keep the official face and existing UI rendering.
- Base: `stackchan-super`. Preserve PR #107 and all existing flash backups; do not reset or overwrite a patched Moddable SDK.
- The factory M5Stack firmware and this repository's Moddable firmware are different products. Do not claim a repository build reproduces the factory firmware.
- No automatic hardware flashing or merging. An uploaded CI artifact is **not** evidence of boot success.

## Layer boundaries
| Layer | Language | Responsibility |
| --- | --- | --- |
| Device drivers | ESP-IDF / C | I2S, camera, PSRAM, USB, watchdog, hardware power |
| Firmware orchestration | Moddable JavaScript / TypeScript | boot state machine, official face UI, capability boundaries, lifecycle |
| AI adapters | TypeScript interfaces | ASR, LLM, TTS; online/offline providers, cancellation, timeouts |
| Development | Node.js | deterministic checks, manifest resolution, firmware build |
| Local provisioning | Bash / Python | USB identity, full flash backup, SHA256, flash and serial capture |

Avoid a Rust rewrite until a specific driver-level defect is isolated and the Moddable/ESP-IDF integration cost is measured.

## Boot state machine
1. **ROM / power**: ESP-ROM output and CoreS3 power rails.
2. **entry**: `main-entry` then `[main] start`. Do not initialize optional debug/screen services before the first checkpoint without bounded diagnostics.
3. **display**: official face rendered, without requiring Wi-Fi credentials.
4. **optional services**: Wi-Fi, MODs, AI, camera start only after the display is stable.
5. **ready**: emit a machine-readable checkpoint; verify no reset loop.

A missing Wi-Fi SSID is an offline condition, not a reason to prevent the face from appearing. Secrets must not enter CI logs or public issues.

## Acceptance gates
| Stage | GitHub CI | Hardware gate |
| --- | --- | --- |
| 0: baseline | TypeScript checks, unit tests, manifest checks, reproducible CoreS3 build | 3 consecutive cold boots; official face visible; USB logs show ready; Wi-Fi absent |
| 1: audio | mock input/output and cancellation tests | microphone capture and full playback with DMA drain |
| 2: AI | provider contract, timeout and offline fallback tests | end-to-end conversation, offline response |
| 3: camera | memory and exclusive resource lifecycle tests | still capture and audio restoration |
| 4: web | API contract and UI regression tests | remote controls plus offline recovery |

The first CI workflow added by this branch is **host-only**: it does not run Moddable/ESP-IDF builds and cannot claim Stage 0 passed. Existing `build.yml` currently targets PRs to `develop`, `feat/moddable-v10-foundation`, and `main`; it does not automatically cover PRs to `stackchan-super`.

## Immediate evidence and next engineering task
The device's 26-line raw boot log repeated: ESP-ROM -> patched AXP2101 rails -> `No Wi-Fi SSID` -> `[startup-checkpoint] step=main-entry state=begin`. No `[main] start` was observed. This suggests inspecting optional archive-debug and archive-screen initialization first, **not** treating the Wi-Fi warning as the confirmed root cause. A USB reset and firmware reset must be distinguished before assigning fault.

Build the minimal host from an explicitly pinned SDK/toolchain. Keep source and artifact SHAs, manifest, toolchain versions and safe serial checkpoints together in the CI release evidence. Never automatically deploy a CI artifact to the user's device.
