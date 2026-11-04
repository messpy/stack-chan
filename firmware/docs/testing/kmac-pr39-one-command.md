# kmac: PR #39を1コマンドでビルド → バックアップ → CoreS3書き込み → #33撮影診断

対象は **kmac / Linux Mint / ESP32-S3(CoreS3) / PR #39** です。実際に接続された本体だけを操作します。GitHub Actionsの成功は実機PASSではありません。

## 1コマンド（既存のGit作業ツリーを壊さない）

**USBでStackChan本体を接続し、元の設定 `firmware/host/app/manifest_archive_private.json` が存在することを確認してください。**

```bash
clear
cd /mnt/data/Development/stackchan/stack-chan && git fetch https://github.com/messpy/stack-chan.git fix/archive-issues-33-38-20261104 && git show FETCH_HEAD:firmware/scripts/kmac-pr39.sh > /tmp/stackchan-pr39.sh && bash /tmp/stackchan-pr39.sh all
```

実行内容は順に：

1. 元のGit作業ブランチ・未コミット変更は触らず、隣の `stack-chan-pr39-acceptance` worktreeを作成/更新する。既存の暗号化Archive設定を秘密値表示なしで引き継ぐ。
2. 専用worktree内に `npm ci --prefer-offline --no-audit --no-fund` でlockfile通りの依存を導入（キャッシュ優先、不足分はネット経由）。元の `node_modules` は変更しない。続いてNode/Pythonテストを実行し、失敗時は書き込まない。
3. 共有Moddable SDKパッチ実行のため **yes/no確認** を行い、既存の `scripts/update-archive.sh --build-only` でCoreS3 Archiveをビルドする。
4. USBは1台だけとし、複数の場合は `STACKCHAN_PORT` で選択する。Hubサービスがポートを使っていれば、停止して終了時に復帰する。
5. **本体の16MiBフラッシュを読み取り、バックアップサイズとSHA256を確認した後で**、書込用の **yes/no確認** を行う。バックアップに失敗したら書き込まない。
6. `scripts/update-archive.sh --flash-only` で書き込む。成功/失敗とログは `firmware/dist/update-logs/` に残す。
7. PC上の既存VOICEVOX `speak.py` で「普通の会話」を再生し、PCマイクでWAV録音する。続けて認証付きUSB `/photo/status` の撮影前状態を保存し、「写真撮って」を再生・録音する。
8. 撮影後の `/photo/status` と比較し、**今回新たに始まった撮影**でJPEGのSD保存が報告されたか検証。`errorStage`（例: `camera-start`、`frame-wait`、`jpeg-encode`、`sd-save`）を表示し、秘密情報を含む生ログは `~/stackchan-e2e/` のローカルに限定する。

**注意:** `all` は書き込み後のVOICEVOX・録音・USB診断が失敗すると非ゼロ終了します。*書き込み失敗と同義ではありません*。USB通信がタイムアウトしても撮影失敗と即断せず、状態を `UNVERIFIED` として扱います。 `dist/update-logs/latest.json` とバックアップを確認してください。

### 状態を調べるだけ（本体変更なし）

上記コマンド末尾の `all` を `check` に変更して実行します。

### ビルドのみ、またはビルド＋書き込み

先のコマンドでスクリプトを取得した後なら、次のどちらか一行で実行できます。

```bash
bash /tmp/stackchan-pr39.sh build
```

```bash
bash /tmp/stackchan-pr39.sh flash
```

`build` はテスト＋ビルド、`flash` はテスト＋ビルド＋16MiBバックアップ＋書込です。いずれも共有SDKへのパッチ適用前に確認します。

### #33の撮影E2Eだけを再実行する（再ビルド・再書き込みなし）

```bash
bash /tmp/stackchan-pr39.sh test photo_explicit
```

前後2回の認証付きUSB診断と「写真撮って」の音声再生・録音を行います。PCに `pyserial` が必要です。撮影後に新しい保存が認められても、実際のJPEGの画質やAI画像認識は自動PASSにしません。

### その他の音声E2Eを試す

```bash
bash /tmp/stackchan-pr39.sh test mode_recognition_on
```

`mode_recognition_on` は「文字起こしをオンにして」を実際のスピーカーから再生します。実機がすでに会話ONであることが前提です。他の18件は `python3 firmware/scripts/voice-e2e.py list` で一覧できます（ここでは `all` と異なり特定ケースを指定します）。

本体の認証済みUSB/Hubから別プロセスで取得したデバッグログがあれば `STACKCHAN_DEVICE_LOG=/path/to/decoded.log` を渡せます。runnerはその**追記分の件数とSHA256のみ**保存します。USBの認証・Hubのログ取得をrunner自身が行うわけではありません。追加STTは `STACKCHAN_STT_COMMAND='whisper-cli -m /path/to/model.bin -f {wav}'` で指定できます。録音ファイルだけでASR/LLM実行を証明したことにはなりません。

結果：`~/stackchan-e2e/<UTC timestamp>-<case>/` に `run.json`・`review.json`・`pc-mic.wav`、任意の `device_log_summary.json` と `pc_stt_candidate.txt` を保存します。#33については同ディレクトリ内の `photo-status-<UTC timestamp>-<PID>/before.json`・`after.json`・`*.usb.log` に、秘密値を出さない状態とローカル専用デバッグ記録を分けます。**review.jsonの各根拠が埋まるまでは UNVERIFIED です**。

### 複数のUSBシリアルがある場合

既存コードと今回のラッパーは、明示された1ポートだけを利用します。例：

```bash
STACKCHAN_PORT=/dev/ttyACM0 bash /tmp/stackchan-pr39.sh flash
```

別のESP32-S3も接続されている場合、必ず対象がStackChan本体であることを確認してください。自動検出は「1台だからStackChan」とは保証できません。

## すぐに戻す方法（旧ファームウェア）

`~/stackchan-backups/core-s3-YYYYmmdd-HHMMSS-<commit>.bin` がバックアップです。復元は**フラッシュ全体をバックアップ時点に戻す操作**で、NVSも巻き戻ります。SDカードの内容は読み書きしません。

```bash
bash /tmp/stackchan-pr39.sh restore /home/kmac/stackchan-backups/core-s3-実際の日時-commit.bin
```

実際のファイル名へ置き換えてください。復元時はビルド・private manifest・worktreeは不要です。対象ポート、16MiB、SHA256を再検証し、yes/noで確認してから実行します。**Flash backupとSD card backupは別です。**

## リスク・判定

- 本体は電源ON・USB接続・書き込み可能権限が必要です。複数USBがある場合はポートを明示します。
- **ビルド時の既存updaterは共有Moddable SDKへ `patch-*.py` を適用します。**この変更はGit worktreeの外です。実行前に確認し、変更が必要ならSDKの既知のチェックアウト/再セットアップで復旧します。スクリプトは共有SDKを無断で巻き戻しません。
- PR #31で実機動作していた首振りの `archive-head-motion.js` とテストを#39へ移植し、同じ音声による重複首振りも抑止しました。ただし**実機首振り・公式顔の表示は再確認が必要**です。
- #34：会話ON→再起動、OFF→再起動、文字起こし切替の**保存値・ライブ接続・実音声**の3点を一致確認してください。両方OFFでは音声のON指示を認識できません。画面または認証済みUSBでONにしてください。
- #37：撮影・音量・首振り・30分連続会話は人の観察と実機証拠が必要です。ユーザーの許可なくファームウェアをマージしません。
- `/tmp/stackchan-pr39.sh` は起動ランチャーのみで、秘密鍵・APIトークンは含まれません。バックアップ・録音・実機ログはローカルで保管し、GitHubにpushしないでください。

公式esptoolのフラッシュバックアップ形式は `read-flash 0 0x1000000` です。バックアップ生成に成功したことと、旧版ファームウェアが問題なく再起動することは別の検証です。
