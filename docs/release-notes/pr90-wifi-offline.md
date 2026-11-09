# Wi-Fi settings and offline boot preservation

Release impact: patch. Offline startup no longer clears saved credentials. It is a
per-boot connection decision, respected by both standard startup and Archive auto
reconnect. Explicit reconnect/save releases the decision. Native and WASM launch
paths accept the distinct offline result and continue startup. The confirmation
text now describes the non-destructive action in all three languages.

Archive reads existing NVS Wi-Fi settings when its SD vault has no Wi-Fi entry.
Reading does not migrate or rewrite either credential store. Re-saving the same
SSID with an empty password retains the effective existing password.

Tests exercise saved preference preservation, offline launch completion, standard
boot suppression despite manifest defaults, Archive reconnect suppression and
explicit resume, and NVS fallback without a vault write.

The pre-update flash backup contains nonempty Wi-Fi entries; values were not
printed. Old/new NVS partition offsets and sizes match. No restoration, device
configuration change or flash operation was performed during this investigation.
The reported physical startup error still requires its displayed phase/message
or a captured startup log. These software tests do not establish its cause or
prove physical offline startup succeeds.
