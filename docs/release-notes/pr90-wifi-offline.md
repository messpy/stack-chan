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

Startup evidence follow-up (release impact: patch): early scalar-only USB startup
packets no longer depend on Archive initialization/RPC arming. Failure is saved
before cleanup, and RTC records current/previous phase/sequence/error class.
The host collector decodes only allowlisted startup JSON, preserving no exception
message or conversation. Timer retries are bounded and cannot diagnose a stopped
JS VM live; RTC may survive a software reset but not power loss. Hardware startup
cause remains unconfirmed until the diagnostic build is exercised.

## Issue #60: behavior初期化の診断

起動時の5処理、既定動作、Archive初期化のコンポーネントをUSB/RTCとエラー画面へ記録します。XSの拡張子なしモジュール形式を解析し、非同期失敗を完了扱いにしません。設定・NVSは変更しません。実機のReferenceError原因と公式Face表示は診断更新後に再確認が必要です。
