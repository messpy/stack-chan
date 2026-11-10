# XiaoZhi playback ownership (2026-11-10)

Release impact: patch. Related: #93. #94 concerns the independent alarm WAV
player and is not fixed by this change.

## Reproduced defect and fix

SDK `80076c48f5ab87ce29de728071b7408599071a12` accepts `listen()` (cloud TTS
start) only in SPEAKING (user microphone) state. A continuation starting in
WAITING (previous playback drain) therefore leaves the adapter treating the new
PCM as finished. Its drain callback can close I2S and reopen the microphone
before the continuation's stop. The Worker then sets `uploading=true` and skips
downlink binary audio while presentation/text callbacks can still show subtitles.

The adapter now accepts a start during WAITING without discarding queued PCM.
It invalidates the old drain generation, including callbacks already scheduled
on the main event queue. Completion rechecks pending writes and the shared ring
before releasing the output. XiaoZhi start/stop/listened messages also carry a
turn number: the Worker rejects a stale acknowledgement even when another cloud
start and stop both occurred before the acknowledgement arrived. Terminal drain
and close retain ownership and cannot be revived by a late start.

The base SDK, Opus codec, I2S configuration, amp sample-rate setup, volume policy,
buffer sizes, official Face, camera handoff and offline preferences are unchanged.
Gemini uses the same adapter completion guard but does not require XiaoZhi turn
fields. No vendor SDK files are patched.

## Evidence limits

The user observed visible answer subtitles with no audible answer. The last
hardware source was `25211aaeaecb455f52809cb8c0384595e60d3754`. The 11:58 log
contains ASR final chars=1, then a five-second debug/status timeout. Its
`queued=128 dropped=58 usbRetries=2975` are USB diagnostic counters, not lost
Opus packet counts. Buffered log delivery times are not original event times.

The last recorded internal free/largest block were 64155/31744 bytes, PSRAM free
4791200 bytes and native stack minimum free 25216 bytes. These do not establish
allocation failure, fragmentation as a cause, stack overflow, or VM failure.
The ASR-to-answer gap and subtitle presentation do not prove whether the
hardware received and decoded audio. The reproduced race is a confirmed code
defect, not a proven explanation of every observed silent response.

## Stage counters

`[audio-path] stage=decode` reports cumulative binary fragments received,
fragments skipped while uploading, successfully decoded packets, PCM bytes and
decode/parser failures. Fragment count differs from packet count because a
WebSocket packet can arrive in pieces. Recognition-only traffic remains excluded
from playback. Reports are rate-limited to two seconds plus stop/failure.

`stage=output` reports native submitted/completed bytes, successful write chunks,
failures, pending writes and software volume in thousandths. `completed=1` means
the software queue and conservative DMA wait finished. Native callbacks mean
I2S submission, not independent proof of speaker sound or physical DMA progress.
Counters retain no speech, subtitles, audio payloads or credentials. There is no
extra diagnostic polling or per-packet USB request.

## Tests and hardware acceptance

From firmware:

```bash
MODDABLE=/home/kmac/work/moddable-pr87-pr89 \
  node --experimental-vm-modules scripts/lib/archive-xiaozhi-playback-lifecycle.test.mjs
node scripts/lib/archive-playback-buffer.test.mjs
node --experimental-vm-modules scripts/lib/archive-xiaozhi-recognition.test.mjs
```

The lifecycle suite executes the production adapter, queue, XiaoZhi Worker and
(when MODDABLE is supplied) actual SDK base. Only platform I/O, codec output and
scheduling are simulated. Ten tests cover continuation/jitter, queued stale
callbacks, late PCM, cross-Worker acknowledgement races, stale stop, closed
sessions, native enqueue/codec failures, and ten turns with byte-for-byte PCM
order and exactly one microphone restart per turn. This does not measure real
Opus quality, DMA consumption, heap leaks, speaker power or audible output.

Before flashing, integrate this small PR with the existing boot recovery/camera
work (#90/#92) in a separate worktree. Do not replace the deployed boot fixes
with the older stackchan-super alone. Use the existing `~/stackchan.sh --repo`
entrypoint; keep USB identity, 16MiB backup, SHA256 and artifact checks enabled.
Do not merge on test or build success alone. Hardware acceptance requires visible
subtitles AND audible complete answers over ten turns, with microphone restart
only after output drain, plus camera/Face/offline regression checks.
