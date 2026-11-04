# Archive CoreS3 #33–#38: software findings and hardware acceptance

Base branch: `stackchan-super`. Issue #32 is explicitly out of scope. The user wants the original face and captions near the bottom; do not merge the old top-caption change in PR #25 without resolving #35.

## Evidence / scope

| Issue | Confirmed in source | Fix or test in this branch | Device validation still required |
|---|---|---|---|
| #33 | Photo handlers skipped explicit `camera.start()`, chat bypassed `busy`; a cloud tool was the only capture trigger | Explicit photo intent; one photo/analysis in flight per request; `camera.start()`/`capture()`/`stop()`; touch pauses through runtime; reject negated/unsolicited camera requests; async busy safety | New JPEG versus actual subject; stop/recovery under USB; conversation after capture; native hang |
| #34 | Old recognition mode was checked *after* saving transcription OFF. Invalid encrypted vault files could be read as empty OFF, or fallback to an older valid slot without notice | Snapshot previous mode; stop old session; rollback failed handoffs; guard unreadable vault writes; warn on partial recovery; log persisted mode & live connection; strict voice mode switching and no transcription tools | Reboot ON/OFF with real SD; recognition→chat; chat→recognition; audio hardware ownership |
| #35 | Current `stackchan-super` uses `bottom:40` in transcript paths; unpositioned errors used UI defaults. PR #25 (unmerged) changes to top | Single bottom-caption wrapper in direct chat, camera explanation bottom, regression check | CoreS3 LCD screenshot: ASR, AI, errors, long multi-line text and official face |
| #36 | Archive volume UI used an unbounded promise preview chain; TS bounded `VolumePreviewQueue` existed but was unused there | Reuse bounded queue; strict Japanese voice command parsing and authorized, deduplicated volume tools; numeric applied-volume diagnostic; actual audio must be checked | 20↔30 ten times; reset reason, panic, brownout, actual speaker amplitude |
| #37 | A local PC test candidate was not in GitHub; no evidence-gated portable tool existed on target branch | 18 case catalog including #34 boot/transcription scenarios, PC playback/recording, independent STT candidate and bounded debug marker summaries; strict review gate | Real recordings, ID-correlated authenticated USB/Hub logs, new photos, physical motion evidence |
| #38 | SDK-generated concurrent `idf.py add-dependency` calls can overwrite one shared manifest | Pre-seed camera/JPEG/audio codec from tracked manifests for Archive; independent targets unchanged; replay tests | Clean CoreS3 build on kmac with actual Moddable/IDF |

Focused #34/#37 steps: [PC acoustic and cold-reboot acceptance](./voice-e2e-pc.md). When both modes are OFF, a voice ON command cannot be recognized without an independently running microphone recognizer. The new voice commands can switch between active modes and turn a mode OFF, not wake an entirely stopped ASR.

This is **not** evidence that the device is fixed. A Node/Python PASS is only a software-level regression result. Keep PR as Draft until device checks pass. The local custom `manifest_archive_private.json` is intentionally ignored and must not be pushed (it contains a token).

## Read-only preflight on kmac

Run these individually in the repo/worktree containing the proposed branch:

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan/firmware
git status --short --branch
node --experimental-vm-modules --test scripts/lib/archive-build-preflight.test.mjs scripts/lib/archive-issues-33-36.test.mjs scripts/lib/archive-ai-mode-persistence.test.mjs scripts/lib/idf-dependencies.test.mjs
python3 -m unittest discover -s scripts -p 'test_voice_e2e.py' -v
python3 scripts/voice-e2e.py list
```

Do not modify the user's existing dirty tree to run tests. Use a separate git worktree if necessary.

## Real acoustic path (no firmware write)

Only run after inspecting the local `speak.py` and checking ALSA devices and microphone routing.

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan/firmware
python3 scripts/voice-e2e.py capture \
  --case photo_explicit \
  --speak-command 'python3 /home/kmac/work/camera-voicevox/speak.py {text}' \
  --record-command 'arecord -q -f S16_LE -r 16000 -c 1 -d 15 -t wav {wav}' \
  --timeout 30 \
  --firmware-sha "$(git rev-parse --short HEAD)" \
  --provider xiaozhi \
  --output-dir /tmp/stackchan-voice-e2e
```

The tool writes a time-stamped case directory containing `run.json`, `review.json` and optional `pc-mic.wav`. It does **not** read the CoreS3 or query USB/Hub automatically. Add real per-request ASR/LLM/tool IDs and observed evidence to `review.json` (each required check needs both `verified: true` and a nonempty evidence description). Then:

```bash
clear
python3 scripts/voice-e2e.py evaluate --run-dir /tmp/stackchan-voice-e2e/REPLACE_WITH_ACTUAL_RUN_DIRECTORY
```

Status codes: `PASS=0` (explicit human evidence), `FAIL=1` (an observed failure), `UNVERIFIED=2` (missing evidence), `FATAL=3` (invalid input). Human observation and automatic evidence collection must be described separately. Do not include API credentials or private transcripts in shared GitHub logs.

## Device acceptance matrix

1. #33: photo explicit; repeated/overlapping commands; denied photo; ordinary chat no photo; photo after OFF while capture pending; USB/debug logs for start/frame/save/stop; verify the *new* JPEG, not an old file.
2. #34: save chat ON, cold reboot, confirm saved + actual session; repeat OFF, transcription ON and mode switches while speaking; failure injection for SD write/ownership.
3. #35: capture screen for ASR, response, error, camera analysis, long text and setup; subtitle remains below status and original face remains recognizable.
4. #36: 20↔30 at least 10 round trips, monitor actual acoustic output; record reset reason/backtrace/brownout/heap if reboot occurs. JS preview queue cannot prove the cause of earlier hardware reset.
5. #37: run 11 cases with actual PC speaker and microphone; match ASR event IDs, device images and human physical observations. For 30-minute stability record continuous timestamps and heap trend.
6. #38: first run Node tests, then `npm run build:archive` on kmac with its proper SDK setup and private manifest; repeat after `npm run clean` only after checking backup/impact. Confirm all three external dependencies in the generated `idf_component.yml` and that release output belongs to the new commit.

## Integration / rollback

Existing PR #31 is Draft and includes overlapping #33/#34 camera/session work, as well as unrelated #32 motion fixes. **Do not blindly merge both**. Rebase or cherry-pick only the validated nonduplicate hunks; keep #32 untouched. PR #25 conflicts with the required bottom caption. PR #28's boot preference fix is already merged.

Do not flash from CI. Before device deploy save the previous flash image and commit SHA, review SD config continuity, and keep the earlier known-good firmware ready for restore. A firmware upload is outside this PR and requires user approval.

## CI evidence

`Archive Issues 33-38 Regression` runs the offline Node/Python tests on each PR change and attempts a clean ESP32 build from a disposable (untracked) Archive manifest. The CI build never writes firmware to USB. The live run and job conclusion must be checked separately before recording a build PASS; a pending run is **not** success.
