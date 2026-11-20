# Archive async I2S output

`stackchan-async-output.c/js` derive from Moddable's
`modules/io/audioout/esp32/audioout-esp32.c/js` at SDK commit
`80076c48f5ab87ce29de728071b7408599071a12`. Original copyright and LGPL
notices are retained. Native entry points and the module name are distinct;
no shared SDK patch, private manifest edit, or replacement of other audio
providers is required. The existing Archive server manifest registers the module.
This driver is used by Archive chat playback on CoreS3.

The SDK version allows both `audiooutDeliver()` and `audioOutLoop()` to consume
`elements`, `bytesAvailable`, `position`, and `stagingOffset`, without a lock.
One can select the same byte range while the other is writing it. In addition,
the ISR walks nodes the machine can unlink/free. Shared PCM buffers alone do
not protect that native queue.

Changes:

- A task mutex protects the complete native PCM read/write/cursor transaction,
  enqueue, and completion unlink. No XS callback or native task join runs while
  holding the mutex. GC roots survive until completion delivery.
- The ISR never traverses queue nodes. It atomically caps DMA credits and wakes
  the native task, which checks a close flag as well as its notification. A stop
  notification cannot be lost to a later DMA notification during close.
- Completion delivery checks the closed flag even with multiple messages in
  flight. Native buffers and the mutex are released after the native task exits.
- I2S short writes become errors rather than silently consuming the full PCM
  range. The queue latches a write error and rejects subsequent queued PCM.
  Existing JS failure handling closes I2S and exposes the playback error.
- Constructor failures unremember the object and immediately release native
  allocations. The volume factor is sampled atomically for each write.

The existing DMA auto-clear behavior remains enabled: starvation produces
silence. This does not prove that network jitter caused the reported sound.
The host C harness compiles the production structs and drain/write functions
with a mocked I2S sink, two pthread consumers and UBSan. It checks actual PCM
bytes at three volume factors, exactly-once cursor progress, short writes and
latched failures. Hardware task scheduling, ISR behavior, acoustic quality and
heap stability still require physical validation. Keep the PR Draft.
