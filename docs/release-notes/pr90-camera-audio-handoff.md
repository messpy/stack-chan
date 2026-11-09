# PR #90 camera/audio handoff review

Release impact: **patch**. Hardware acceptance is required before merge.

The camera worker shipped in Moddable `80076c48f5ab87ce29de728071b7408599071a12`
only receives task notifications while idle. Once streaming starts, stop/close
notifications can remain pending indefinitely (including when all frame slots
are occupied). Native close waits for task termination. The CoreS3-specific
native override now polls notifications during capture, acknowledges stop before
returning buffers, coalesces readable callbacks, and defers freeing the native
record until its queued callback drains. Explicit close still terminates the
worker and deinitializes the camera before returning. Mutex/task allocation failures now return an error instead of waiting for an initialization that cannot start; failed initialization also releases its rooted native record. These are fault-injection results, not measured hardware RAM limits. The upstream camera license
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
Speaker/mode changes invalidate stale continuations. Photo history keeps the speaker captured at request start, and stale analysis cannot replace the new speaker’s balloon. JSON fields are bounded
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
The PC media test uses a checked-in, provenance-tagged compatibility fixture instead of depending on a sibling hub checkout; live external hub E2E remains separate. No credentials are committed. CI creates a throwaway private manifest; that build
is a compile check and is not a configured deployment image.

The C regression test executes the actual native worker and teardown functions
with RTOS/driver doubles. Device-wrapper tests execute the actual TypeScript with
a native double. Speaker tests evaluate the production callbacks, including
Gemini/Ollama handoff, transport retry, >60s blocking, OFF and speaker changes.

## Hardware update (requires explicit approval)

`firmware/scripts/stackchan.sh` is the single local entry point. On kmac,
`~/stackchan.sh` links to this file. Paths to the preserved original private
manifest, Node, SDK/IDF exports and the known USB unit are configured internally.
No arguments means read-only `--check`. See [operation instructions](../stackchan-cli.md).

```sh
bash ~/stackchan.sh --check
bash ~/stackchan.sh --test --build
bash ~/stackchan.sh --write
bash ~/stackchan.sh --logs --seconds 90
# Explicit complete workflow, inside tmux; still asks before device access/write:
bash ~/stackchan.sh --all
```

With `--PR 90`, the script fetches the current PR/base and locally merges them
in a dedicated worktree. Conflicts stop the workflow. It never merges a GitHub
PR or changes the original worktree. Without `--PR` no source is fetched.
There is no configuration erase or photo request.
`--repo` and `--sha` select an existing worktree/reviewed HEAD without changing it.
Build records source/SDK/configuration/image fingerprints; `--write` reuses only
matching artifacts and validates the CoreS3 partition layout to protect NVS.
SD backup is waived by the user's instruction. A verified private 16MiB flash
backup is retained. Default execution asks for backup/write approval; explicit
`--yes` preapproves the selected operations and skips terminal questions without
skipping device identity, artifact, backup or service-state checks. The board must already
be in manual download mode: no automatic DTR/RTS reset is attempted by esptool.
After writing, bounded passive startup capture is armed and the user presses RST.
Only allowlisted startup/reset lines are saved; startup detail text is omitted
because it can contain private values. Capture completion is not boot acceptance.
The hub is restored only if it was active before the operation. Failures and
signals stop further work and print the failing STEP, command and log path.
SIGKILL or host power loss cannot run service cleanup; recover a previously active
hub manually with `systemctl --user start stackchan-hub.service`.

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
