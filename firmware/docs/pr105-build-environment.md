# PR #105: CoreS3 build environment recovery

Release impact: none. This change fixes host automation and its tests; it does
not change firmware behavior or require a firmware release note.

## Diagnosis (kmac, 2026-11-10)

The installed CLI invoked `build:archive:m5stackchan_cores3`, which is absent
from both the stackchan-super base and the PR #105 integration package.json.
The available `build:archive` uses the generic CoreS3 platform; it is not a
replacement for the custom `m5stackchan_cores3` target.

A direct invocation of `build:m5stackchan_cores3` without environment activation
failed because MODDABLE was unset. The previous SDK search incorrectly required
`tools/mcconfig/mcconfig.js`; this SDK has `tools/mcconfig.js`.

Existing SDK, reused without reinstalling or editing:
- Path: /home/kmac/work/moddable-pr87-pr89
- Moddable version: 10.0.2
- Git HEAD: 80076c48f5ab87ce29de728071b7408599071a12
- Tracked-file SHA256 (including local patches):
  f0ae534e604b788f5c4de35f2d9a0db2a997bb38c2bdc328f42b9dd6e5192f71
- This fingerprint matches the previous successful build receipt under
  stackchan-audio-evidence-20261110/previous-build-25211aaeaecb.
- Existing changes in worker, audio input/output, camera, xsHost and xsPlatform
  files were preserved.

ESP-IDF export: /home/kmac/.local/share/esp32/esp-idf/export.sh, resolving to
/mnt/data/Development/stackchan-sdk/esp32/esp-idf.
Version v6.1, commit fff9895c82d744c7237be8847347bdd1b07c6643,
matching the previous receipt. Node v22.23.4, npm 10.9.9, Python 3.12.3.

The firmware command wrapper and npm scripts are unchanged between the selected
stackchan-super base and PR integration. The mismatch was in the host CLI's
assumption about the selected worktree's npm interface.

## Build path

The CLI detects the existing patched SDK independently of the selected repository,
validates its layout and executable mcconfig, sets MODDABLE and PATH, activates the
existing ESP-IDF export, checks tool availability and TypeScript dependencies, and
records tool versions without dumping environment variables.

An explicitly supplied invalid MODDABLE fails closed; it never silently chooses
a different SDK. Supply MODDABLE and IDF_PATH explicitly to use another existing
installation. If dependencies are missing, restore the existing tools or run
`npm ci` in the selected firmware directory; no automatic reinstall occurs.

The CLI checks npm script names before changing the private manifest. It preserves
private module/platform settings and restores the previous manifest on exit.
It runs `prebuild:archive` to generate the archive resources, then invokes:

```sh
npm run build:m5stackchan_cores3 -- --mode=release --manifest "$PWD/host/app/manifest_archive_private.json"
```

The repository wrapper manages output beneath firmware/dist. The CLI validates
ESP32-S3, dio/16MB/80MHz, flash image addresses and NVS separation, and writes a
receipt containing source/SDK/IDF/config fingerprints and artifact SHA256 values.

## Use

From any directory, select the worktree explicitly:

```sh
bash ~/stackchan.sh --repo /path/to/stack-chan-worktree --test --build
```

For PR integration, after the corrected CLI is installed:

```sh
bash ~/stackchan.sh --PR 105 --test --build
```

A clean tracked tree is required. Existing untracked node_modules symlinks are
preserved. Failures report `[FATAL] STEP=... REASON=...`, exit status, log path,
a redacted log tail for command failures, and recovery guidance. Environment
snapshots are held in memory, not written to disk; run directories are private.

Future explicitly authorized device operations can use the existing `--all`
flow inside tmux. USB identity checks, full-flash backup, SHA256 verification,
NVS exclusion, and startup confirmation remain in place. No device operation
was performed during this recovery.

The PC media-trash page test also previously assumed Hub was a sibling of the
firmware worktree. It now uses STACKCHAN_HUB_ROOT, defaulting to ~/work/hub on
kmac. Hub is an existing separate checkout; no Hub files are modified. If it is
elsewhere, set STACKCHAN_HUB_ROOT to its directory before running the tests.
A missing page fails with a recovery message rather than skipping the test.

## Verification

On the integration branch (CLI fix 25f97f00), with MODDABLE and IDF_PATH removed
from the parent environment:
- CLI: 76 passed, 0 failed.
- npm test:unit: 552 passed, 0 failed.
- Archive suite with the activated SDK: 76 passed, 0 failed.
- CoreS3 release build, flash layout and artifact validation: passed.
- Private manifest restored; original shared configuration fingerprint unchanged.
- Negative CLI check with MODDABLE=/tmp/pr105-no-such-sdk: stopped at
  STEP=environment, exit 1, with FATAL, reason, saved log and recovery instructions.
- No flashing, reset, SD changes or Hub service changes.

Primary log directory:
`/tmp/pr105-validation-runs/run-20261110-232543-xbdune4l`.

The second worktree exposed the separate Hub-path dependency; the test fix is
included here and its full verification is recorded in the PR validation section.
The existing Hub page fixture used for that verification has SHA256
e9901e4ac6c2845ea1b93cd9ae416488e591b82aa557199e5fa312558db2eb4d.
