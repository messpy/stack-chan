# P1 — CoreS3 内部RAM削減：USB受信バッファのPSRAM移動（Issue #40）

## 現場で確定したこと

- 2026-11-07 kmac → CoreS3 (XiaoZhi) 実機ログ。
- 音声「写真撮って。」はASR成功、`camera_describe` ツールも呼ばれたが、XiaoZhi会話中の `new ImageInCamera` が失敗した。
- 会話を止めたUSB `/photo` は176×144 JPEGをSDに保存できた。その後 `state=retrying` とLED消灯が継続。
- 接続失敗の明示メッセージ: 「内蔵RAMの空きが不足しています（空き 79175 / 連続 31744 バイト）」。
- 接続開始ガードは **112 KiB internalFree / 24 KiB internalLargest**。79,175B時の不足は **35,513B**。
- PSRAMは約6.5MBの空き。PSRAMが余っていても、DMA/スタック等が要求する内部RAMの代替にはならない。

## 本PRの変更と効果範囲

既存の `archive-usb.c` はフレーム用の `static char line[20005]` を常駐の **内部BSS** に確保していた。

- この配列を `heap_caps_malloc(20005, MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT)` に置き換える。
- USB受信初回だけ一度確保し、受信フレームの最大サイズ・`@SC ` プロトコル・溢れ時のドロップ処理は維持。
- PSRAM確保失敗時は明示的にエラーとし、**内部RAMへフォールバックしない**。内部RAM保護を優先する。
- `heapStatus()` に `usbRxPSRAMBytes` (0 または 20005) を追加。認証情報、文字起こし、音声データは記録しない。
- 静的な内部RAM確保が**約20KB減る設計**。実機の利用可能ヒープ増加が20KBちょうどになるとは限らない。

この変更 **だけでは** 実測不足分35,513Bを満たせない可能性が高い。安全基準を下げず、既存PRのカメラ解放・音声受け渡し対策と組み合わせる必要がある。

## 検証

1. Node 22: `node --test firmware/scripts/lib/archive-usb-psram.test.mjs` （割当先・サイズ・溢れ検知に関するソース回帰）
2. Node 22: `node firmware/scripts/lib/archive-memory-policy.test.mjs` （112 KiB/24 KiBガードの維持）
3. kmac: 私有設定 `manifest_archive_private.json` をGitに含めず、CoreS3 **実機ビルド**・16MiBバックアップ後に書き込み。
4. 起動後、USBの認証付き `/status` で `chat.memory.internalFree` / `internalLargest` / `usbRxPSRAMBytes` を記録。新項目はUSB受信初回後 **20005** を想定。
5. **同じ条件**で待機時・XiaoZhi接続直前・会話中・撮影後・再接続後を比較。内部RAM不足で再接続できないなら未解決と判断する。
6. 本PRではESP32実機ビルド・USBでの接続・撮影・音質は**未検証**。静的テストはCランタイムの保証ではない。

## 依存・次の対策

- PR #56: USB会話/カメラログ、撮影後の `robot.camera.close()`。**未マージ**で本PRには含まない。
- PR #55: 会話中撮影の音声/カメラリソース受け渡し（別の積み重ねPR）。
- PR #51: RAM不足再接続の無制限ループ停止。**RAMの空き自体は増やさない**。
- 次段階: Opus/Worker/DMA/ネットワークの内部RAM必要量を機能別実測し、PSRAM化できるバッファのみ追加移行。24KiB nativeStackやRAM安全閾値の見込み変更はしない。

## ロールバック

本PRの `archive-usb.c` の変更をrevertして以前のファームウェアを再ビルドする。実機で復旧が必要なら、kmacに保存したSHA256付き16MiBバックアップから復元（SDは含まれない）。個人のUSB認証情報や診断ログはPRに添付しない。
