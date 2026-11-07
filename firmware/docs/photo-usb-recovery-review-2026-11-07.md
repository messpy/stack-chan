# CoreS3 USB /photo freeze: implementation and self-review (2026-11-07)

## Observed facts (do not conflate with hypotheses)

- Previously, authenticated USB `/status` succeeded and reported `chat.state=listening` with internal free SRAM **64,999 B** and largest contiguous block **31,744 B**.
- The following `/photo` failed to return within 30 seconds. Subsequent `/status` returned nothing until a device reboot.
- An earlier voice-photo attempt successfully produced a 176×144 RGB565 frame (50,688 B), then USB timed out **before** any verified JPEG/SD completion.
- Linux retained `/dev/ttyACM0`; no USB disconnect was logged after the 15:05 re-enumeration. This neither proves nor excludes a native driver deadlock.
- Camera firmware running at each failure has not been conclusively matched to a Git commit.

## Implemented containment

1. `archive-usb-rpc.js`: a serialized USB dispatcher keeps authenticated read-only `/status` and `/debug/status` responsive while an asynchronous operation is in flight. Mutating operations fail with Busy. After 25s, report timeout **without unlocking** the unfinished task; prevent duplicate replies on late completion. USB write failures are contained.
2. `archive-memory-policy.js`: after voice shutdown and a short scheduling gap, collect and measure internal SRAM until either 96 KiB free and 32 KiB contiguous become available or 1.5s elapse. Fail closed with a recoverable error rather than initializing the camera with known insufficient memory. Both USB and explicit voice-photo routes use it. Timeouts are based on monotonic `Time.ticks`.
3. `lan-archive.js` / `runtime-camera.ts`: instrument capture, JPEG, SD and teardown phases. Hold CoreS3 touch panel paused until the native camera is closed. Wait for camera close before releasing the photo lock.
4. `archive-usb.c`: independently scheduled 60s `esp_timer` photo watchdog; if camera/JPEG/SD blocks the XS JavaScript task for a minute, request `esp_restart()`. The guard is armed only during explicit still-photo processing and disarmed on cleanup. Mark guard-induced software resets in RTC no-init RAM. USB `/status` exposes `usbOperation.watchdogReset`.
5. Updated host USB camera-probe script shows sanitized phase milestones, busy state and watchdog-reboot flag; does not print authentication tokens or ASR text.

## Independent review / residual risks

| Area | Review result |
| --- | --- |
| USB head-of-line blocking | Addressed only when the JavaScript event loop keeps running. A synchronous C hang necessarily blocks its USB RPC callback. |
| Native freeze recovery | 60s ESP timer is a fail-safe, **not** a guarantee when all FreeRTOS scheduling is blocked. Hardware validation remains required. |
| SD integrity | Emergency reboot during SD write may leave an incomplete JPEG or damaged FAT metadata. Back up important SD data before testing. |
| Memory admission | 96KiB free / 32KiB contiguous are protective thresholds, not measured proof that every driver allocation will succeed. |
| Camera sensor | CoreS3 uses GC0308 and emits RGB565; JPEG requires software encoding. Do not substitute JPEG sensor mode without hardware evidence. |
| Security | Request token remains required, retries never print token, and probe hides conversation text. |
| Concurrency | Lock remains held after a timed-out request until it actually completes; no second camera operation runs while the first is unresolved. |
| Tests | Node functional tests cover USB busy status, timeout lock, auth rejection, sync/async failure, memory recovery; lifecycle tests guard phase ordering and watchdog wiring. |
| Hardware build | GitHub smoke CI does not compile ESP-IDF/Moddable. CoreS3 build, flash, real photo, image integrity and reboot behavior are **not verified**. |

## Acceptance checklist on kmac

1. Confirm clean Git tree or back up local edits. Fetch this PR branch, then run `bash scripts/stackchan-ci.sh test`.
2. Run `bash scripts/stackchan-ci.sh deploy` **only after reading its 16MiB flash-backup and USB-port prompts**. Do not unplug USB while flashing. Preserve the backup file and SHA256 checksum.
3. After boot, check USB `/status` before photo. First run one `/photo` with AI conversation OFF (no cloud analysis). Confirm `CAMERA_CAPTURE`, `JPEG_DONE`, `CAMERA_SAVE`, and `CAMERA_CLOSED` plus image readability.
4. Next run with XiaoZhi listening. Expect voice shutdown and successful camera memory admission, or a recoverable insufficient-RAM response. `/status` should remain responsive during **asynchronous** camera work.
5. If a native hang recurs, wait for watchdog recovery only if safe to leave the device powered and SD activity has stopped. On reboot inspect `usbOperation.watchdogReset`, reset reason, and recovered SD content. **Do not perform repeated crash-inducing tests on valuable SD cards.**
6. Restore the previous 16MiB flash backup with the existing recovery procedure if boot, face, touch or AI talk regresses. SD data require separate backup.

## References

- Hardware: https://docs.m5stack.com/ja/core/CoreS3
- M5 CoreS3 camera sample (GC0308 RGB565 and `M5.In_I2C.release()`): https://docs.m5stack.switch-science.com/ja/arduino/m5cores3/camera

The PR must stay draft until a CoreS3 firmware build and controlled hardware acceptance tests have passed.
