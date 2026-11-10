# CoreS3 IMU startup fallback (2026-11-09)

Release impact: **patch**.

## Symptom and evidence

A CoreS3 boot log reports `[startup] component=imu state=failed phase=context error=Error`. The IMU hardware constructor or its `configure` method can throw while `createStackchanContext()` is running. The report does not establish whether hardware, I2C contention, or firmware timing is the root cause.

## Change

- Only the **optional IMU input** is disabled when IMU initialization throws. The context continues to create Face/touch/audio/camera; other startup failures remain fatal.
- IMU driver logs whether the failing stage was `constructor` or `configure`, without printing arbitrary exception messages. On configure failure the partially initialized driver is closed; cleanup errors do not override the original error.
- No change to NVS credentials, SD card contents, Wi-Fi state or servo configuration.
- Tests cover healthy initialization, failure and cleanup behavior.

## Acceptance still required on hardware

- Confirm official Face and touch controls start even when the IMU is unavailable.
- Confirm healthy IMU motion detection still works.
- Inspect actual `[IMU] initialization failed stage=...` records and distinguish real sensor/I2C failure from software defects.
- Confirm camera/audio and offline startup independently. This patch does not prove those paths succeed.
- Keep original full flash/SD backup and SHA256 verification; rollback with the verified image if regressions occur.

This is a focused follow-up built **on top of PR #90** to retain the camera/Wi-Fi work; compared against `stackchan-super`, the proposed PR includes PR #90's changes as well.
