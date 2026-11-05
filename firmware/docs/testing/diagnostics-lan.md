# CoreS3 read-only LAN diagnostics (stacked on PR #39)

## Scope and safety

- Draft diagnostic instrumentation for #40 RAM pressure, #32 servo communication, #36 restarts and #37 real E2E testing.
- This change is stacked on PR #39 branch `fix/archive-issues-33-38-20261104`, not merged into `stackchan-super`. It must be reviewed and built before flashing.
- `GET /diagnostics` requires the **existing Archive bearer token** and returns a small allowlisted snapshot only. It does not modify the motor, microphone, Wi-Fi or flash.
- `archive-lan-diagnostics.py` polls this endpoint, stores timestamped JSONL on **kmac** with mode 0600, and does not store IPs, tokens, transcript text, images, raw debug lines, or an unbounded log queue on ESP32.
- `--motor-once` is optional; it performs **one** existing read-only `/motor-status` query, which uses the servo's half-duplex UART. **Only run with the head stopped.** It does not toggle torque/power or move the servos.
- RAM marks use the existing trace queue at connection preflight, connect failure, delayed chat cleanup, monitor start/stop, photo start/end and Archive startup. Each record contains stage tags and numeric memory data only.
- The LAN sampler does **not** export raw native trace logs or persistent reset reasons. A reboot or fatal panic may interrupt sampling; reset reason/panic backtrace requires a separate native/boot path in #36.
- If LAN fails, the JSONL records an `unavailable` sample rather than reporting a test pass.
- This is **not** an automatic fix for RAM shortage, physical servo nonresponse or missed photos.

## Preflight

On kmac, verify that the device firmware actually includes this diagnostics patch and that the local private manifest matches the device. A new script alone cannot enable the endpoint on old firmware.

Verify LAN reachability without transmitting credentials:

```bash
clear
ping -c 2 192.168.2.102
```

Run a one-time snapshot from the firmware workspace (adapt IP and paths to the actual deployment):

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan/firmware
python3 scripts/archive-lan-diagnostics.py \
  --ip 192.168.2.102 \
  --config host/app/manifest_archive_private.json \
  --output "/tmp/stackchan-diag-$(date +%Y%m%d-%H%M%S).jsonl" \
  --samples 1
```

For an interval study (120 seconds at two-second intervals):

```bash
clear
python3 scripts/archive-lan-diagnostics.py \
  --ip 192.168.2.102 \
  --config host/app/manifest_archive_private.json \
  --output "/tmp/stackchan-diag-$(date +%Y%m%d-%H%M%S).jsonl" \
  --samples 60 --interval 2
```

Stop all head movement first to add **one** servo status query via `--motor-once`; its `reasonClass` is a category rather than the device's free-text native error.

## Interpretation

- `heap.internalFree` and `heap.internalLargest` distinguish total internal RAM from the largest allocatable contiguous block. Compare values before/after chat/camera/monitor events; do not reduce the 112-KiB XiaoZhi guard as a workaround.
- `chat.failureClass=memory-pressure` means the device reported memory pressure; `retrying` alone is not proof of network failure.
- `servo.lastReadFailure` describes the **last position-read attempt from the Web monitor**, not a continuously polled physical sensor; `motor-once.pan/tilt.reasonClass` comes from an explicit read when enabled.
- `debug.dropped` increasing means the in-RAM debug queue lost events. This snapshot mechanism does not need USB but cannot retrieve historical raw trace text.
- `photo.phase` is the firmware's latest reported stage, not independent validation of the JPEG content.
- If the device resets, preserve the last PC snapshot and collect native reset reason separately; don't infer a brownout or panic without evidence.

## Regression and integration

```bash
node --experimental-vm-modules --test firmware/scripts/lib/archive-diagnostics.test.mjs
python3 -m unittest discover -s firmware/scripts -p 'test_archive_lan_diagnostics.py' -v
```

The stacked PR's base is PR #39, which remains Draft. Run the existing full CoreS3 Archive clean build, unit suite and hardware acceptance on the combined code before marking the diagnosis complete or integrating to `stackchan-super`. Do not close #40, #32 or #36 from CI alone.
