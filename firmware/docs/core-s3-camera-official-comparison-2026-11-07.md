# Issue #33 / #40: M5Stack公式 CoreS3 カメラと音声同時実行の比較（2026-11-07）

## 一次情報と比較

- M5Stack CoreS3 公式 Camera: https://docs.m5stack.com/ja/arduino/m5cores3/camera
- M5Stack公式 GC0308 実装: https://github.com/m5stack/M5CoreS3/blob/main/src/utility/GC0308.cpp
- Moddable公式 camera.c: https://github.com/Moddable-OpenSource/moddable/blob/public/modules/embedded/io/image/in/camera/esp32/camera.c
- Moddable CoreS3ターゲット: https://github.com/Moddable-OpenSource/moddable/blob/public/build/devices/esp32/targets/m5stack_cores3/manifest.json

| 設定/動作 | M5Stack公式 | Moddable CoreS3 + 本プロジェクト |
| --- | --- | --- |
| カメラセンサー | GC0308 | GC0308 |
| フレームバッファ | PSRAM 2個 | PSRAM 3個（SDKデフォルト） |
| 画像取得 | `CAMERA_GRAB_WHEN_EMPTY` | `CAMERA_GRAB_LATEST` |
| 既定の解像度 | QVGA 320×240 | 本アプリの要求は QCIF 176×144 |
| I2C | `M5.In_I2C.release()` → `esp_camera_init()` | Moddable camera.js/native経由。Touch停止あり、公式と同じI2C解放は未確認 |
| Moddableボード側定義 | N/A | camera SDA=12 SCL=11 port=1 |
| archive例示manifest上書き | N/A | SDA=-1 SCL=-1 port=0。実機の単体撮影は成功しており、根拠なくGPIO変更しない |
| 独立したXiaoZhi音声 | なし | Opus/WebSocket/TLSと画像取得が同時に実行され得る |

**確定ログ**: 会話中 `new ImageInCamera` で `camera init failed` 相当の例外、単独USB撮影は176×144 JPEG保存に成功。後続XiaoZhi接続は内部RAM 79,175B（112KiB必要）で拒否。公式は会話を同時実行していないため、そのまま設定をコピーして直る保証はない。

## 本統合ブランチの安全な是正

- PR #56: `stop()` のみではなく `close()` によりカメラネイティブを解放。
- PR #57: 常駐USB受信20KBを内部BSSからPSRAMへ移動。112KiB/24KiB安全ガードは維持。
- 追加: **明示的な「写真撮って」系**の最終ASRだけをローカル処理。
  - まず現在のXiaoZhi/Opus/TLSセッションを閉じて内部RAMを解放する。
  - 認識コールバック外へ遅延してカメラを初期化し、SDへ保存（`analyze:false`）。画像をクラウド解析しない。
  - `camera.close()` 後にXiaoZhiの再接続を予約する。普通の会話や引用・否定文はローカル撮影に転用しない。
- PC側: VOICEVOXスクリプトの終了コードだけでは聴こえた保証がない。新規生成WAVがあれば `pw-play`/ `paplay` / `aplay` によって明示的に再生し、実際の出力先を表示。

## 未解決・現地受入

1. **実機ファームウェアビルド・書き込みは未実施**。CIはソーステストであり、カメラ成功の証明ではない。
2. 公式の `fb_count=2` / `CAMERA_GRAB_WHEN_EMPTY` は次の比較候補。Moddableを直接パッチするとSDK共有環境への影響があるため、メモリ・撮影の改善を測定するまでは変更しない。
3. I2C解放は touch/amp/mic の復帰に影響し得るため、公式サンプルをそのまま移植しない。
4. 新ローカル撮影は **明示的写真保存だけ**。自然言語によるカメラ画像分析 `camera_describe` の内部RAM/クラウド連携は別途修正が必要。
5. E2E: 起動→緑LED→写真コマンド→SD画像検証→緑LED復帰→通常会話。USB `diagnose` の `LOCAL_PHOTO_START/DONE/ERROR`、`CAMERA_ERROR` と `connection_detail` を確認。
6. kmac 音声: WAV生成成功、再生コマンド成功、**耳で聞こえること**は独立した3段階として検証。ソフトウェアの終了コードだけで可聴性を断定しない。

## ロールバック

書き込み前に16MiBフラッシュをSHA256付きで保存。PC側Gitは `git switch --detach` で対象コミットを切替可能。共有SDKのカメラ実装は変更していない。既存PR #55には同様の写真前音声解放案が存在し、この統合ブランチでは重複のない最小実装を検証する。二重マージ時には同様のローカル撮影ハンドラが重ならないよう調整する。
