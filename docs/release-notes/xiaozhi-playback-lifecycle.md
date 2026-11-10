# XiaoZhi continuation playback

Release impact: patch.

Fix a race where a new XiaoZhi answer starts while the previous answer is
draining. Preserve queued audio and invalidate stale completion callbacks so
they cannot close the speaker or resume microphone upload during the next
answer. Turn-tagged Worker acknowledgements also reject crossed completions.

Add bounded, content-free decode/output counters and regression tests for
continuations, late PCM, failures, closed sessions and ten consecutive turns.
Physical speaker output still requires CoreS3 acceptance; see
[`firmware/docs/xiaozhi-playback-lifecycle.md`](../../firmware/docs/xiaozhi-playback-lifecycle.md).
The independent alarm WAV tail defect in #94 is not included.
