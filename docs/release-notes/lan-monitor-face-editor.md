# LAN monitor and custom face editor

Release impact: minor.

- Add authenticated LAN camera and microphone monitoring, fixed neck poses, LED controls, and local speech. Monitoring pauses AI conversations, keeps media in RAM, and ends after inactivity or browser dismissal.
- Add a browser face editor with bounded, validated drawing data and persistent custom faces.
- Apply SDK fixes for audio input ring capacity and self-posted message queue handling during archive updates.
- Fix camera preview routing to pass the authenticated request context.

The device HTTP interface is intended for a trusted local network. Do not expose port 8082 directly to the Internet; the QR access token grants access to device controls and private media. Cloud hosting of this source repository does not make the device interface suitable for public hosting.

Validation: LAN monitor tests, archive UI tests, HTTP parser tests, update-status tests, and C harnesses for the audio ring, self-message queue, and promise checkpoint. Hardware builds and on-device validation remain outstanding.
