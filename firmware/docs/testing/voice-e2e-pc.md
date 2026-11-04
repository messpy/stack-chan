# PC ↔ CoreS3 real-acoustic validation (Issues #34 and #37)

**Status:** Tool and unit tests are implemented, but results are **UNVERIFIED** until actual CoreS3 observations are recorded. This procedure does not flash or change firmware. It does generate PC-side WAV/review files. Use the firmware build from PR #39 only after reconciling the working #32 servo firmware with PR #31.

## kmac preflight (read-only)

OS: Linux Mint. Prerequisite: separate working tree checked out to PR #39; do not overwrite dirty local files.

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan/firmware
printf '[CHECK] Branch and HEAD\n'
git status --short --branch
git rev-parse --short HEAD
printf '[CHECK] PC sound device\n'
arecord -l
aplay -l
printf '[CHECK] Existing VOICEVOX script\n'
test -f /home/kmac/work/camera-voicevox/speak.py && echo '[INFO] VOICEVOX script exists'
printf '[CHECK] PC E2E tests\n'
python3 -m unittest discover -s scripts -p 'test_voice_e2e.py' -v
python3 scripts/voice-e2e.py list
```

If the local checkout is not PR #39, first set up a *separate worktree*. Never replace local changes just to run these tests. Verify CoreS3 is on the corresponding firmware revision; do not infer from a local Git HEAD.

## Hardware signal chain

1. Place the PC speaker near the CoreS3 microphone; check actual VOICEVOX playback and appropriate acoustic volume.
2. Use PC microphone (USB or laptop) to capture CoreS3's reply. Verify `arecord` reads the intended hardware source; if necessary, pass an explicit ALSA device instead of `default`.
3. Separately connect to the **authenticated Archive USB/Hub debug interface** to collect device events. `miniterm` alone cannot guarantee buffered Archive `trace()` messages, and sharing a serial port between two processes may fail. An optionally provided `--device-log` must be an already collected *decoded* debug file being appended during the run. This runner does not authenticate to the device itself.
4. Keep any API keys, device tokens, private conversation transcripts, voice recording, and complete debug logs on kmac; only bounded marker counts and SHA256 are copied into test summaries.
5. **Important:** No microphone/ASR can execute a new "AI ON" voice command when *both conversation and transcription are OFF*. Turn one mode ON manually via the device screen or authenticated USB before that case. Do not mark the impossible OFF→voice ON case as PASS.

## Run one real test

Start with conversation ON on the device and a physically connected/working speaker and mic. The example command is **not** a claim that the devices are already available.

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan/firmware
python3 scripts/voice-e2e.py capture \
  --case mode_recognition_on \
  --speak-command 'python3 /home/kmac/work/camera-voicevox/speak.py {text}' \
  --record-command 'arecord -q -D default -f S16_LE -r 16000 -c 1 -d 20 -t wav {wav}' \
  --output-dir /tmp/stackchan-voice-e2e \
  --provider xiaozhi \
  --firmware-sha "$(git rev-parse --short HEAD)"
```

The program writes `run.json`, `review.json` and an optional `pc-mic.wav` into a timestamped run directory. `run.json` records times, test case, program failure and firmware SHA passed by the user — **not a device-side trusted measurement**.

Optional external evidence:
- `--device-log /tmp/stackchan-debug-decoded.log` saves only markers/hashes for bytes appended while the trial runs, never raw debug contents. If the log is absent, the summary records an error.
- `--stt-command 'whisper-cli -m /path/to/whisper-model.bin -f {wav}'` stores `pc_stt_candidate.txt` as a **candidate** transcript for manual acoustic comparison. Neither independent ASR nor waveform presence proves that the StackChan actually heard or replied to the prompt.

## #34 priority acceptance matrix

| Sequence | Precondition / action | Required proof |
|---|---|---|
| Chat ON → cold reboot | Persist Chat ON, reboot device manually | `[boot-mode] restored conversation ON` plus matching saved value, `[mode-session] connected mode=conversation`, real ASR/reply |
| Both OFF → cold reboot | Persist both OFF, reboot manually | `[boot-mode] restored explicit OFF`, no unexpected ASR or cloud access; monitor active for adequate time |
| Chat → transcription | In chat say 「文字起こしをオンにして」 | `[mode-voice] applied`, old session closes, saved mode changes, transcription session connects |
| Transcription only | Say 「写真撮って」 | ASR text displayed; **no** JPEG, head movement, LLM reply or audio response |
| Transcription → Chat | With transcription ON say 「AIモードをオンにして」 | Mode flags change, old session closes, new chat connects and answers next utterance |
| Transcription → OFF | With transcription ON say 「文字起こしをオフにして」 | Saved OFF, no active microphone/session |
| Unreadable settings | Only through controlled test fixtures, do not corrupt real SD | Existing snapshots not overwritten, warning visible, no silent OFF default |
| Handoff failure | Controlled audio ownership injection in unit test; actual busy scenario on device | Original persisted mode unchanged, warning returned, no misleading success banner |

Other #37 cases include explicit/negated photos, output audio, volume 20/30, physical head movements and long-conversation stability. See `voice-e2e-cases.json` for all 18 cases.

## Evaluate evidence

After each run, add independently observed evidence to each required check in `review.json`:

```json
{
  "checks": {
    "asr": {"verified": true, "evidence": "CoreS3 ASR event ID and actual recognized phrase matched"},
    "mode": {"verified": true, "evidence": "USB status before/after, saved mode and observed session all matched"}
  },
  "notes": "Time, serial-debug capture reference, firmware SHA and physical observation"
}
```

Use the required keys for the particular case; leave unknown values null.

```bash
clear
python3 scripts/voice-e2e.py evaluate --run-dir /tmp/stackchan-voice-e2e/REPLACE_WITH_ACTUAL_TIMESTAMPED_CASE
```

Exit status: `0 PASS` only with explicitly documented evidence, `1 FAIL`, `2 UNVERIFIED`, `3 FATAL`. CI success does **not** satisfy physical acceptance.

## Remaining unautomated hardware tasks

- Capturing authenticated device-side Hub events and correlating ASR/LLM tool identifiers to this PC run is not yet automatic.
- Physical servo displacement, newly stored JPEG content and audible speech need an observer; a debug marker alone cannot prove them.
- Cold reboot must be triggered manually and verified against the actual flashed firmware. Do not flash PR #39 until PR #31 integration is reconciled.
- The long session check requires elapsed wall time and heap/reset trend evidence. Run duration is **not** established by a single stimulus.
