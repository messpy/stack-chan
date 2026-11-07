# CoreS3 会話中カメラ割り込み・PSRAMフレーム数調整（2026-11-07）

## 実機エビデンス（PR #58 / commit bfb4891）

kmac USB `/photo`（画像解析なし）は `VOICE_RELEASE → RAM_CHECK → RAM_BLOCKED` で安全に停止した。
写真は撮れていないが `/photo` と直後の `/status` は応答。USB watchdog リセットなし。

| 指標 | 会話中 before | 音声解放後 | 旧閾値 |
| --- | ---: | ---: | ---: |
| internalFree | 32,787 B | 130,091 B | 96 KiB |
| internalLargest | 7,680 B | 31,744 B | 32 KiB |
| psramFree | 4,705,300 B | 6,572,656 B | 指定なし |

**断片化が原因で旧チェックに拒否されたことは確定。ただしカメラ本体が30KiBの領域で確実に動くことは未検証。** 内部 RAM の総量と最大連続領域は区別する。

## M5Stackソースとの比較

- 出荷系 C++: [M5Stack/StackChan `stackchan_camera.h`](https://github.com/m5stack/StackChan/blob/main/firmware/main/hal/board/stackchan_camera.h) は EspVideo を継承し、C++ HAL がカメラを起動時に準備する。実際の `EspVideo` は [78/xiaozhi-esp32 v2.5.2](https://github.com/78/xiaozhi-esp32/blob/v2.5.2/main/boards/common/esp_video.cc)。
- Arduino SDK の参考設定: [M5Stack/M5CoreS3 GC0308](https://github.com/m5stack/M5CoreS3/blob/main/src/utility/GC0308.cpp) は `fb_count=2`, `CAMERA_FB_IN_PSRAM`, `CAMERA_GRAB_WHEN_EMPTY`。
- 改造版の Moddable [camera.c](https://github.com/Moddable-OpenSource/moddable/blob/public/modules/embedded/io/image/in/camera/esp32/camera.c) は `fb_count=3`, `CAMERA_FB_IN_PSRAM`, `CAMERA_GRAB_LATEST`。フレームの処理方式が違うため、公式と同じ設定を使っても同等の実機動作は保証されない。

## 今回の変更（このPRに上積み）

1. `scripts/patch-core-s3-camera.py`: ModdableのCoreS3カメラ用SDKファイルだけを、上記Arduino側の **2フレーム／WHEN_EMPTY** に合わせる。C側のキュー枠 `kCameraFrameCount` も2にする。認識済みの原文だけ置換し、未確認のSDK版ではビルド前に停止する。初回変更前に `camera.c.stackchan-original` を同じ場所へ保存して再実行時は変更しない。**共有SDKを書き換えるため他のModdableビルドにも影響しうる。**
2. `archive-memory-policy.js`: 固定32KiB連続域の門前払いを30KiBへ調整し、96KiB内部RAM空きと1MiB PSRAM空きも必須とした。これは今回の実測値を**撮影試験対象にするため**の条件であり、カメラの動作保証ではない。RAM不足なら引き続き拒否する。
3. `archive-direct-chat.js`: 音声停止後の30秒タイマーで撮影中にXiaoZhiが再接続できる競合を除去。`beginCameraHandoff` 中は `connect` とリトライループを禁止し、`finishCameraHandoff` の後に再接続する。
4. `lan-archive.js`: USB撮影も同じハンドオフロックを採用し、`RAM_READY` のログを追加。音声コマンドの単体撮影もロック対象。成功・RAM拒否・カメラエラーの全経路で解放を試みる。
5. 回帰テスト: RAM条件・SDKパッチの冪等性と異常版拒否・USB／音声両経路の再接続排他を確認。

## 手順と受入条件（未実機検証）

1. kmacでPR #58先頭コミットを確認し、`bash scripts/stackchan-ci.sh test`。ソーステストは**ハードウェア成功の根拠ではない**。
2. `bash scripts/stackchan-ci.sh build`。共有SDKを自動パッチするのでビルド前の影響・バックアップ先を確認する。
3. SDカードと16MiBフラッシュをバックアップし、`bash scripts/stackchan-ci.sh deploy` で書き込み。書き込み前の確認 `yes` が必要。
4. 起動→公式顔とタッチ→ USB `/status` → AI OFF写真→AI ONで「写真撮って」→ `RAM_READY` / `CAMERA_SAVE` / `CAMERA_CLOSED` → `listening` 復帰を検証。
5. テスト前後の `internalFree`、`internalLargest`、`psramFree` とSDのJPG整合を検証する。以前の30秒USB応答停止を再現するなら追加ログを解析。連続試行はしない。

## 注意・復旧

- 既存の独立60秒撮影watchdogは有効。SD保存が停止中に再起動するとファイルが壊れる場合がある。SDに重要なファイルがある場合は必ず別途バックアップ。
- SDKパッチの復旧には、変更中のビルドを停止した上で、`$MODDABLE/modules/embedded/io/image/in/camera/esp32/camera.c.stackchan-original` を対応する `camera.c` へ戻し、再ビルドする。共有SDKを使う他ビルドへの影響を確認すること。
- 元の16MiBフラッシュは既存のバックアップファイルから復旧可能。ただし**SDKバックアップとフラッシュバックアップは別物**。
- 本体の最新ファームウェアはPR #58の旧版 `bfb4891` のまま。GitHubソースを更新しただけで本体は自動更新されない。
