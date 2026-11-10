# CoreS3 startup ReferenceError: bounded diagnostics (PR #102)

## Incident and limits

On 2026-11-11, kmac flashed PR #105 locally integrated into `stackchan-super`.
The firmware transfer and 16MiB flash backup/SHA256 check succeeded; the
CoreS3 displayed a startup failure (`ReferenceError`). The host's filtered
`boot-stages.log` contained only `ESP-ROM:esp32s3-20210327`.
Neither this symptom nor the absence of an application log identifies the
offending variable, module, source file or stack frame.

This change is diagnostic only. It is **not** evidence of a repaired startup,
nor of camera/audio/face acceptance. The existing successful pre-flash backup
must be preserved. Do not erase NVS, overwrite SD, or merge/flash for diagnosis
without operator review.

## Implementation

`main.ts` assigns a stable checkpoint immediately before each side-effectful
startup operation, from dock initialization through `context-behaviors`,
`archive-import`, `archive-start` and final setup. On failure, **before
asynchronous cleanup**, it emits one fixed-schema `event=startup` JSON record
through the existing `archive-usb.writeDebugUSB()` only when that module is
bundled and available. Failure or a full native USB queue does not replace the
original exception. The original startup error UI remains unchanged.

Example (schematic):

```text
@SC {"event":"startup","component":"archive-import","componentState":"failed",
"phase":"behavior","error":"ReferenceError","reason":"unclassified",
"site":"host-main","sequence":0,"stage":115,
"previousValid":0,"previousSequence":0,"previousStage":0,"previousError":0,
"resetReason":11,"internalFree":42000,"internalLargest":21000,"psramFree":6000000}
```

The existing `stackchan.sh` `boot-stages` allowlist recognizes these keys,
phases, components and error classes. Numeric stage IDs **101–117** belong to
this host checkpoint map and are *not* the legacy native RTC stage IDs.
`sequence=0`, `previousValid=0` and the other `previous*` zeros mean
**no persisted prior checkpoint**, not evidence of an actual prior stage.
A zero RAM/reset measurement may likewise mean unavailable, not actual zero.

The record never serializes an exception message/stack, a dynamic module path,
Wi-Fi credentials, tokens, prompts, transcripts, or arbitrary input fields.
Only allowlisted phase, component, class, static site and bounded scalar values
appear on the unauthenticated USB boot channel.

## Mapping and interpretation

| Stage | Component | Meaning |
| --- | --- | --- |
| 101–105 | dock-context, runtime-input, runtime-ui, runtime-timer, default-behavior | Host setup, localization and behavior resolution |
| 106–107 | default-behavior, experimental-miniapps | Launch/mini-app preparation |
| 108–109 | runtime | Network start/ready |
| 110–111 | preferences, runtime | Preferences/context creation |
| 112–114 | dock-context, experimental-miniapps, context-behaviors | Context attachments and default behaviors |
| **115** | **archive-import** | **`Modules.importNow('lan-archive')` (module graph/manifest compatibility)** |
| **116** | **archive-start** | **`startArchive(context)` startup of local services** |
| 117 | runtime | Final shortcut registration |

A stage identifies only **the operation being attempted**, not the exact
undefined symbol/line. Stage 115 suggests inspecting the private archive
manifest against the built module graph, because a previously reported
`ReferenceError` had a plausible missing-alias cause (PR #46). The current
incident is not proven to be that historical regression.

## Verification

- Node: `cd firmware && node --test scripts/lib/startup-diagnostics.test.mjs`.
- Existing startup-failure fixtures: `npm run test:unit` and the Moddable
  startup error manifest suite (where supported).
- CoreS3 build: `bash ~/stackchan.sh --PR 102 --test --build`, **only after**
  reviewing the other incomplete integrations and checking clean worktree/SDK.
- Any later owner-approved device acceptance must preserve USB identity, create
  and SHA256-verify a fresh 16MiB flash backup, then validate normal boot.
  A future `boot-stages` run must capture the new event **while the USB
  monitor is already attached**, before a brief manual RST press.

## Known limitations

- The USB packet is best effort: unplugged USB, driver failure, transport
  saturation or reset before catch may produce no event.
- Static ES-module load failures **before `main()` enters its `try`** are
  not observable by this checkpoint reporter.
- A checkpoint does not expose an undefined symbol. A verified next step
  may be to add further narrowly scoped trace points inside the reported
  component while keeping secrets redacted.
- PR #102 is an incomplete system-category integration; this change does not
  authorize merging other included functionality or flashing it to hardware.
