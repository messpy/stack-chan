# Standalone StackChan archive and conversation extension

Release impact: minor. Target: M5Stack CoreS3 / completed M5Stack StackChan.

From `firmware/`, run `npm run init:archive` to create the ignored, mode-0600 private manifest with a fresh random local-access token, then `npm run build:archive` and `npm run deploy:archive`. Use the existing managed SDK/ESP-IDF environment. The example manifest contains no deployed credentials. Do not commit the private manifest or copy its token into source.

The firmware supports USB and authenticated LAN/AP control, SD photos/video/audio, streamed alarm audio and timers, encrypted Wi-Fi/API settings, and SQLite profiles/history. Speech and image requests use the selected Gemini or XiaoZhi provider; failures do not fall back to another provider. XiaoZhi image uploads are restricted to HTTPS api.xiaozhi.me/api.tenclass.net. Gemini API keys are entered through the local settings UI and are never echoed.

Before conversation, choose a registered person, register through the browser, or choose guest. No microphone conversation session starts before selection. Only a short profile and the latest three related records enter the initial context. Person and assistant messages are associated with that selected person; profiles remain separate from transcripts.

Button definitions use `text`, `background`, `textColor`, `method`, and `args`. Methods are explicitly registered callbacks; button text and percent-prefixed AI text are not evaluated as code. Timer/alarm actions use the existing MCP methods such as `timer_create` and `alarm_create`.

The device settings menu contains Wi-Fi/API setup, LAN QR, explicit AP operation, signal strength, and AI selection. LAN operation waits for a LAN address and never auto-enters setup AP mode. Lost Wi-Fi retries with bounded backoff. Browser-uploaded JPEG/PNG/WebP images are converted to JPEG at up to 800 pixels, stored on SD, and linked to the question and result in history.

Checks: `npm run test:archive-ui`, `npm run test:archive-http`. Node 22.13+ is required for the SQLite/TypeScript test helpers. Hardware testing additionally covers SD readback, provider authentication, camera, servo movement, and Wi-Fi display. Never include SD media, conversation databases, credentials, or diagnostic logs in Git.
