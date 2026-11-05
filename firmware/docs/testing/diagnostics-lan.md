# CoreS3 read-only LAN diagnostics (stacked on PR #39)

## Scope and safety

- Draft diagnostic instrumentation for #40 RAM pressure, #32 servo communication, #36 restarts and #37 real E2E testing.
- This change is stacked on PR #39 branch `fix/archive-issues-33-38-20261104`, not merged into `stackchan-super`. It must be reviewed and built before flashing.
- `GET /diagnostics` requires the **existing Archive bearer token** and returns a small allowlisted snapshot only. It does not modify the motor, microphone, Wi-Fi or flash.
- `archive-lan-diagnostics.py` polls this endpoint, stores timestamped JSONL on **kmac** with mode 0600, and does not store IPs, tokens, transcript text, images, raw debug lines, or an unbounded log queue on ESP32.
- `--motor-once` is optional; it performs **one** existing read-only `/motor-status` query, which uses the servo's half-duplex UART. **Only run with the head stopped.** It does not toggle torque/power or move the servos.
- RAM marks use the existing trace queue at connection preflight, connect failure, delayed chat cleanup, monitor start/stop, photo start/end and Archive startup. Each record contains stage tags and numeric memory data only.
- The LAN sampler does **not** export raw native trace logs. It **does** expose the ESP-IDF `esp_reset_reason()` integer read at Archive startup as `boot.resetReasonCode` and a monotonic `boot.uptimeMs` counter (no flash write). A reboot or fatal panic may interrupt sampling; panic backtrace and detailed crash evidence still require a separate native/boot path in #36.
- If LAN fails, the JSONL records an `unavailable` sample rather than reporting a test pass.
- This is **not** an automatic fix for RAM shortage, physical servo nonresponse or missed photos.

## kmac setup, safe flash and snapshot

These changes live in **PR #41**, which is not merged. Fetch the exact PR branch into the original kmac repository; the existing checkout is never reset.

**1. Read-only preflight — no build or flash.** Run from an interactive kmac terminal:

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan || exit 1
git fetch https://github.com/messpy/stack-chan.git fix/archive-diagnostics-20261105 || exit 1
git show FETCH_HEAD:firmware/scripts/kmac-pr39.sh > /tmp/stackchan-pr41.sh || exit 1
STACKCHAN_SOURCE_REF=FETCH_HEAD \
STACKCHAN_ACCEPTANCE_WORKTREE=/mnt/data/Development/stackchan/stack-chan-pr41-acceptance \
bash /tmp/stackchan-pr41.sh check
```

**2. Only after CI success and on-site confirmation, build + 16MiB backup + flash.** The updater requests separate `yes` confirmation for the shared Moddable SDK patch/build and for device flashing. The backup is checksummed before writing. USB must identify the single intended CoreS3.

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan || exit 1
git fetch https://github.com/messpy/stack-chan.git fix/archive-diagnostics-20261105 || exit 1
git show FETCH_HEAD:firmware/scripts/kmac-pr39.sh > /tmp/stackchan-pr41.sh || exit 1
STACKCHAN_SOURCE_REF=FETCH_HEAD \
STACKCHAN_ACCEPTANCE_WORKTREE=/mnt/data/Development/stackchan/stack-chan-pr41-acceptance \
bash /tmp/stackchan-pr41.sh flash
```

The `flash` mode runs the existing #39 tests **plus #41 diagnostics tests**, builds, backs up the complete 16MiB ESP32 flash with SHA256, then asks for flashing approval. It does **not** replace SD card data or auto-confirm writes. The original working tree remains untouched. Keep the path to the backup printed by the script.

**3. Collect read-only diagnostics after the new firmware boots.** Do not run this on the old firmware, which has no `/diagnostics` endpoint. Change the LAN IP if the QR shows a different address:

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan-pr41-acceptance/firmware || exit 1
python3 scripts/archive-lan-diagnostics.py \
  --ip 192.168.2.102 \
  --config host/app/manifest_archive_private.json \
  --output "$HOME/stackchan-diag-$(date +%Y%m%d-%H%M%S).jsonl" \
  --samples 60 --interval 2
```

This samples for about 120 seconds and writes a private 0600 JSONL file on kmac. Observe RAM before and after enabling XiaoZhi, then after manually ending monitor/camera activity; don't repeat motor motion while collecting.

For the *existing* servo symptom, stop the head first and add `--motor-once` to the command above to perform **one** read-only diagnostic (this contacts the UART but never moves/toggles the servos). Do not repeat the motor diagnostic continuously.

**4. Interpretation and rollback.** A successful build or flash is not a physical acceptance PASS. If network access is lost, the sampler records `unavailable`. If the device fails after flashing, restore the checksummed 16MiB ESP32 backup via the same updater's `restore /absolute/path/backup.bin` mode with explicit user confirmation. The ESP32 flash backup does **not** include the SD card.


## Interpretation

- `heap.internalFree` and `heap.internalLargest` distinguish total internal RAM from the largest allocatable contiguous block. Compare values before/after chat/camera/monitor events; do not reduce the 112-KiB XiaoZhi guard as a workaround.
- `chat.failureClass=memory-pressure` means the device reported memory pressure; `retrying` alone is not proof of network failure.
- `servo.lastReadFailure` describes the **last position-read attempt from the Web monitor**, not a continuously polled physical sensor; `motor-once.pan/tilt.reasonClass` comes from an explicit read when enabled.
- `debug.dropped` increasing means the in-RAM debug queue lost events. This snapshot mechanism does not need USB but cannot retrieve historical raw trace text.
- `photo.phase` is the firmware's latest reported stage, not independent validation of the JPEG content.
- If the device resets, preserve the last PC snapshot, reconnect, then compare `boot.uptimeMs` (reset to a low value after reboot) and `boot.resetReasonCode` after reboot. ESP-IDF commonly reports SW=3, PANIC=4, TASK_WDT=6, BROWNOUT=9, but verify enum against the SDK used in the actual build. This is the **most recent reset cause**, not a stack trace. Do not infer a specific failing call without additional evidence.

## Regression and integration

```bash
node --experimental-vm-modules --test firmware/scripts/lib/archive-diagnostics.test.mjs
python3 -m unittest discover -s firmware/scripts -p 'test_archive_lan_diagnostics.py' -v
```

The stacked PR's base is PR #39, which remains Draft. Run the existing full CoreS3 Archive clean build, unit suite and hardware acceptance on the combined code before marking the diagnosis complete or integrating to `stackchan-super`. Do not close #40, #32 or #36 from CI alone.
