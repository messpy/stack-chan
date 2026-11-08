# PR #90 camera/audio handoff review

Release impact: **patch**. Hardware acceptance is required before merge.

The camera worker shipped in Moddable `80076c48f5ab87ce29de728071b7408599071a12`
only receives task notifications while idle. Once streaming starts, stop/close
notifications can remain pending indefinitely (including when all frame slots
are occupied). Native close waits for task termination. The CoreS3-specific
native override now polls notifications during capture, acknowledges stop before
returning buffers, coalesces readable callbacks, and defers freeing the native
record until its queued callback drains. Explicit close still terminates the
worker and deinitializes the camera before returning. The upstream camera license
and provenance are included under `firmware/host/modules/camera/device/native/`.
Other ESP32 camera targets retain their existing native implementation.

The JS device wrapper returns queued disposable frames before native stop and
attempts native close even if stop fails. Runtime shutdown retains its existing
no-touch-resume contract; normal capture release uses frame-close → runtime-stop
(restores touch) → close. Actual DMA/I2C behavior remains a hardware check.

Gemini/Ollama with XiaoZhi ASR now speaks the saved camera analysis through local
TTS after reconnecting, without generating another greeting or camera tool call.
A continuation is retained until local playback succeeds, or until a final reply
arrives on a live transport. A disconnect before a final reply can result in a
retry; exactly-once audible delivery cannot be guaranteed across network loss.
Speaker/mode changes invalidate stale continuations. JSON fields are bounded
before serialization so escaping cannot create a truncated JSON document.

## Build and test

Use Node 22 and the existing Moddable/ESP-IDF environment. From `firmware/`:

```sh
npm run test:unit
MODDABLE=/path/to/moddable node --experimental-vm-modules --test --test-concurrency=1 scripts/lib/archive-*.test.mjs
npm run init:archive
npm run build:archive:m5stackchan_cores3
```

The new named Archive build uses the repository's **official StackChan CoreS3
platform**, not the generic SDK `m5stack_cores3` platform. Existing
`build:archive` remains available for that older generic target. The example
private manifest includes the official target's managed dependencies. Pre-seeding
JPEG with audio/camera prevents concurrent IDF dependency additions from racing.
No credentials are committed. CI creates a throwaway private manifest; that build
is a compile check and is not a configured deployment image.

The C regression test executes the actual native worker and teardown functions
with RTOS/driver doubles. Device-wrapper tests execute the actual TypeScript with
a native double. Speaker tests evaluate the production callbacks, including
Gemini/Ollama handoff, transport retry, >60s blocking, OFF and speaker changes.

## Hardware update (requires explicit approval)

`firmware/scripts/stackchan-pr90-update.sh` is an interactive preparation/update
script. It has **not** been exercised on a real device. Run it inside tmux after
reviewing the final commit and obtaining approval. Source the SDK/ESP-IDF exports
first. Supply the original private manifest separately; the CI-only generated
configuration is refused as the source. It is copied locally, with only the new
module definitions and official-target dependencies synchronized. The previous
ignored configuration is backed up privately.

```sh
EXPECTED_SHA=<reviewed-40-character-SHA> \
PORT=/dev/serial/by-id/<verified-device> \
PRIVATE_MANIFEST=/path/to/original/firmware/host/app/manifest_archive_private.json \
SD_BACKUP_DIR=/path/to/sd-backup-with-SHA256SUMS \
bash firmware/scripts/stackchan-pr90-update.sh
```

The script verifies the PR ref, runs regression checks and the official build,
validates an existing SD backup checksum manifest, identifies the USB unit by
VID/PID/serial/physical location, and preserves the hub's original active state.
It asks separately before reset/16MiB flash backup and before writing. It checks
backup length/SHA256 and image hashes. It writes only bootloader/partition/app
images, never erases the whole flash or initializes SD. Passive boot collection
is bounded to 90s and keeps stage/RAM/state markers, excluding transcripts.
A changed USB identity stops the write; no capture request is sent or retried.
The backup/config/log directory is private and may contain credentials; never
publish it. Cancellation after backup may leave the board in bootloader mode.
Rollback writes the verified full backup at offset 0, with separate approval.

Successful flashing or a JPEG filename is not hardware acceptance. Confirm boot
identity, debug/status, official Face/touch, new decodable JPEG, SD close, image
analysis, camera release and audio reconnection. Measure internal free/largest,
PSRAM and duration before capture, at frame-ready, after native close and after
voice reconnection. Then test 10 consecutive captures, LAN/USB/preview/video,
SD/JPEG/camera failures, and >60s analysis without early audio reconnect. None of
these physical checks is inferred from mocks or a local build.

## Parallel PRs

Against the reviewed PR90 head, three-way merge with #91 is clean; #87 conflicts
in `lan-archive.js`/`package.json`; #89 conflicts in `archive-direct-chat.js`,
`lan-archive.js`, device camera and `package.json`. Proposed order: base → #91 →
reviewed #90 → #87 → selected #89 diagnostics. This is a review plan, not an
instruction to merge. #89 is based on #53 and must not bring its entire historical
dependency chain into the final branch without separate dependency review.
Retain the handoff lease, continuations, native ownership, web input exclusion,
voice-turn tracker, playback drain diagnostics, and both test registrations when
resolving those conflicts. Re-run integrated tests/build after resolution.

## Remaining limits

ESP-IDF framebuffer acquisition/deinit may themselves block synchronously; JS
RPC or a JS timeout cannot recover a stopped VM. This PR does not add a native
watchdog deadline/RTC stage system. Preserve related diagnostics when integrating
#89/#58 work. Actual RAM pressure, Opus/I2S recovery, SD health and prior hardware
failure causality remain unmeasured until approved device acceptance.
