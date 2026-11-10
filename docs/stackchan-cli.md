# StackChan 操作スクリプト

`stackchan --check`（`bash ~/stackchan.sh --check` と同じ入口）は、現在の
worktree情報に加えて、ログ保存先全体から最後に書き込み検証が成功した記録を表示します。
`LAST_FLASH_COMMIT`、`LAST_FLASH_BRANCH`、`LAST_FLASH_FIRMWARE_SHA256`
（appのSHA256）、`LAST_FLASH_BOOT`、根拠となるログパスを出します。
USB未接続で事前確認が失敗しても、その前にこれらの情報を表示します。

今後の書き込みでは、成功直後にコミット・その時点のブランチ・成果物SHA256を
実行フォルダの `flash-record.json` へ原子的に保存し、起動成功は別に追記します。
古いログでは、同じSHAの現存worktree／ビルド記録から得た情報を「推定」と表示し、
確認できなければ `unknown` とします。後続の書き込みが失敗・中断していれば、
実機内容が不明であることも警告します。これはホストの履歴表示であり、
現在動いている本体から読み出したファームウェア識別結果ではありません。

Release impact: none（ホスト側操作の統一。本体ファームウェアの変更なし）。

入口は `firmware/scripts/stackchan.sh`。kmacの `~/stackchan.sh` はこのファイルへのリンクです。引数なしは `--check`。重複していた旧ホストスクリプトは、削除前に復元可能なアーカイブへ保存します。ログ・フラッシュバックアップ・元の認証設定は削除しません。

```bash
bash ~/stackchan.sh --check
bash ~/stackchan.sh --test
bash ~/stackchan.sh --build
bash ~/stackchan.sh --write
bash ~/stackchan.sh --logs --seconds 90
bash ~/stackchan.sh --all
# PRを最新のstackchan-superへローカル統合して一括実行
bash ~/stackchan.sh --PR 90 --all
# 確認入力も引数で事前承認する場合
bash ~/stackchan.sh --PR 90 --all --yes
# テスト・ビルド済み成果物から書き込みだけ再開
bash ~/stackchan.sh --PR 90 --write --yes
```

- `--yes` はこのコマンドで選んだバックアップ・書き込み・hub一時停止・ログ取得を事前承認し、端末へのyes/no入力を省略します。指定しなければ確認入力が必要です。USB同一性、元サービス状態の復旧、16MiBバックアップ、成果物照合、失敗時停止は省略しません。GitHubマージ・撮影要求も追加しません。自動DTR/RTSリセットは行わないため、手動ダウンロードモードへの切替と書き込み後の短いRST操作は必要です。
- `--PR 90`（`--pr`も可）はGitHub CLI `gh` でPRの最新HEAD・baseを確認し、オブジェクトをfetchして専用のdetached worktreeで3-way統合します。元の作業ディレクトリやブランチは変更しません。競合時はテスト・ビルド・書き込みへ進みません。GitHubでPRをマージする操作は含みません。
- 同じbase/HEADでは同じ統合worktreeを再利用するため、`--PR 90 --build` の後に `--PR 90 --write` で成果物を使えます。HEAD/baseが変わった場合は別worktreeとなり、再ビルドが必要です。書き込み前にもPRの更新有無を照合します。`--sha`を併用した場合はPR HEADを固定します。
- `--PR`指定時のworktreeは `/home/kmac/work/stackchan-pr番号-integration-baseSHA先頭12桁-headSHA先頭12桁`。取得・ローカル統合自体は実行しますが、GitHubへのpush/mergeは行いません。`gh`認証やネット接続の失敗でも停止してログを残します。
- 複数指定は確認→テスト→ビルド→書き込み→ログの順です。`--all` は確認・テスト・ビルド・書き込み・起動ログ取得。撮影・会話の自動試験は含みません。
- `--write` / `--all` はtmux内で実行。本体を手動ダウンロードモードにした後、16MiBバックアップの読取りと書き込みを別々にyes/no確認します。自動リセットは行いません。書き込み後はログ取得中に本体RSTを短く押してください。
- `--write` はテストやビルドを再実行しません。この入口で作成したビルド証跡が必要です。初回は `--build` を実行してください。ソース・SDK・元設定・成果物が変わった場合は書き込みを拒否します。証跡は `firmware/dist/stackchan-build-receipt.json`。
- `--test` は既存UnitとArchive回帰テストを実行します。`--build` は公式 `build:archive:m5stackchan_cores3` を実行します。元private manifestを保護し、生成用設定は終了時に元に戻します。
- `--logs` はUSB関連カーネルログと許可された起動phase/resetログを取得。シリアルを開く前に確認します。hubがactiveなら、追加確認後に停止して終了時に復帰。元から停止中なら起動しません。USB切断時は同一VID/PID・シリアル・物理ポートだけを再検出し、要求は再送しません。
- 無関係な通信・会話・認証情報はUSBログに保存しません。例外詳細本文は省略します。書き込み後は `[main] app behaviors ready` の確認が必要で、ログが空／起動失敗なら終了コードを失敗にします。これは撮影・会話などの実機受入成功とは別です。生のテスト/ビルド出力やフラッシュバックアップは秘密を含み得るため、実行フォルダは非公開で保持し、そのままGitHubへ貼らないでください。
- STEP開始・成功・失敗・コマンド・ログ保存先を表示します。エラー時は次のSTEPへ進まず、ログ末尾を表示。Ctrl+C/HUP/TERM時も子プロセスを止め、元のhub状態を復旧します。SIGKILL・ホスト電源断後は自動復旧できません。
- 書き込みはbootloader・partition table・appに限定。NVSとの重なりを検査し、フラッシュ全消去・SD初期化はしません。SDバックアップはユーザー指定で不要です。フラッシュバックアップの復元は別途承認後に行ってください。

既定worktreeは `/home/kmac/work/stackchan-context-recovery-20261109`。Node22、既存ESP-IDF6.1、既存Moddable SDK、元private manifestのパスは登録済みです。

```bash
# 他の既存worktreeを検証する場合（checkoutやfetchはしない）
bash ~/stackchan.sh --repo /home/kmac/work/stackchan-pr87-pr89-integration --test
# 必要ならレビュー済み40桁SHAを --sha で指定
```

実行結果は `/home/kmac/work/stackchan-runs/run-日時-一意ID/console.log`。別の保存先は `--log-root`。USBポート指定は `--port` ですが、指定しても本体の同一性検査は省略しません。

CLI自体の故障注入テスト（ビルド・実機操作なし）：

```bash
python3 firmware/scripts/lib/stackchan-cli.test.py
```

このテストは制御フローと故障時の振る舞いの検証です。ビルド・USB書き込み・CoreS3正常起動の実機検証を代替しません。

`--check` のUSB未検出・複数候補は失敗終了します。hubの `HUB.Result=success` はサービスの前回終了結果であり、USB認識成功ではありません。USB識別失敗時は同じ実行フォルダの `usb-kernel.log` に直近15分のUSB関連カーネルログも保存します。`--all` の事前確認でもUSBを確認し、未認識のまま長いテスト・ビルドへ進みません。

### ROM接続がWrite timeoutになる場合

USB認識成功はROM接続成功とは異なります。手動モードで接続できない場合は、USB Serial/JTAG向けのリセットを初回接続確認に限って指定できます。

```bash
bash ~/stackchan.sh --PR 90 --write --yes --reset usb
```

`--reset usb` は最初のflash-idにUSBリセットを指定します。接続試行回数は1回。失敗時は停止し、バックアップ・書き込みへ進まず、手動モードとの自動切替や書き込み再送は行いません。バックアップと書き込みは引き続きno-reset。従来の手動操作は `--reset manual`（既定）です。USBリセットには本体への影響があります。このオプションと `--yes` を指定したコマンドは、その操作も事前承認します。実機での成功はまだ未確認です。

### 起動エラーがあるのにログがROMだけの場合

release版のtraceはリングバッファへ送られます。従来はArchive起動後かつ認証RPC受信後にだけUSBへ排出し、PC側も `@SC` JSONを除外していたため、アプリ起動失敗の証拠を取れていませんでした。

診断版は `main()` 初期から、認証やSDに依存せず、許可された起動phase・例外クラス・分類候補・スタックのファイル名/行・内部RAM/PSRAMの数値だけを `event:startup` として送信します。エラー本文・SSID・鍵・会話は送りません。エラーはcleanup前に記録。USB非接続時は送信せず、接続後の遅い読み取りにも1秒周期で再掲します（最後のphase更新から最大300回）。通常のdebug ringは従来どおり認証RPC後だけ排出します。

RTCには文字列を含めず起動シーケンス・現在/前回phase・例外分類を保存します。電源断での保持は保証しません。前回RTC値を今回の障害と混同しないようsequenceとpreviousValidを併記します。phase番号は0初期化、1launch、2network、3context、4behavior、5ready、6unknown。reasonはエラー本文のキーワード分類候補であり根本原因の確定ではありません。

JS VMが同期処理で停止すると周期送信も止まります。最後に保存できたRTC checkpointを次の起動で調べます。main呼出し前のmodule import失敗はこの診断の対象外です。診断例外は起動処理へ伝播させません。

### ホストがUSBを列挙できない場合のポート限定復旧

`lsusb`にも本体が出ない場合、esptoolやシリアル名の変更では直りません。既存の失敗履歴と物理接続を確認したうえで、対象の外部ポートだけを1回無効化→再有効化する診断を選べます。ホストのroot権限が必要です。全USBコントローラのunbindや、キーボード/Bluetoothのリセットは行いません。ポートごとのdisable仕様はLinux ABI文書に準拠します（https://github.com/torvalds/linux/blob/master/Documentation/ABI/testing/sysfs-bus-usb）。対応しないハブではVBUS電源断まで行われるとは限らず、復旧を保証するものではありません。

```bash
# kmacの通常端末でsudo認証を準備（rootパスワードをスクリプトへ渡さない）
sudo -v
# 1-1が本体を接続した外部ポートである場合だけ指定
bash ~/stackchan.sh --recover-usb --usb-path 1-1 --yes
```

内部ポート、すでに無効なポート、認識済みの別機器は拒否します。権限がなければサービス停止やポート変更の前に停止します。再有効化はfinallyで実行し、既知VID/PID・serial・物理経路で本体が20秒以内に再認識された場合だけ復旧成功とします。SIGKILL/電源断では後処理は保証できません。終了時にも未認識ならフラッシュせず、ログを保存して終了します。`--write --reset usb` と組み合わせる場合も復旧確認に失敗すれば書き込みへ進みません。

ツールや説明文だけを更新した場合、旧ビルドSHAと現在SHAのファームウェア入力が同一であることをGitオブジェクトで照合し、既存成果物を再利用できます。統一CLIとCLIテスト、ドキュメントだけを除外し、その他のソース/ビルド入力・SDK・IDF・元private manifest・成果物の変更は引き続き拒否します。ビルド証跡のSHAは改ざんせず保持します。


2026-11-09 context復旧版では、sudo子プロセスは同じログインsession内の独立process groupで実行します。
以前のstart_new_sessionではtty単位のsudo認証を失っていました。no-new-privilegesの隔離環境では
引き続き停止します。詳しい根拠・実機source SHA・USB切り分けは
[context/USB調査](recovery/2026-11-09-context-usb.md)を参照してください。
起動エラー画面には秘密を含まない失敗componentとcheckpoint時のRAMを表示します。


### kernel-usb診断の検索コマンド

`--logs` のカーネル検索は、実際に実行する子bash内で `rg` の有無を判定し、なければ `grep -Ei` を使用します。検索0件は正常終了してUSBログ取得へ進みます。journalctlの失敗、検索コマンドの実行エラー、両コマンドとも未導入の場合は区別して停止・ログ保存します。外側のaliasや関数の定義は不要です。本体への要求や自動リセットは追加しません。


### オフライン起動の確認

起動snapshotは `ready` 到達後も `bootNetwork`（connected/skipped/failed/unknown）、`bootOffline`（automatic/selected/not-selected/unknown）、`bootNetworkReason`（定型分類のみ）を保持します。SSID・パスワード・接続エラー本文は記録しません。これは起動時点の結果で、現在のインターネット疎通を意味しません。旧ファームウェアでフィールドがない場合も収集できますが、オフライン起動の証拠にはできません。

```bash
# 現在のローカル修正ブランチをビルドして書き込み（tmux内）
bash ~/stackchan.sh --build --write --reset usb --yes
# 成功済みビルドを書き込むだけ
bash ~/stackchan.sh --write --reset usb --yes
# 起動ログのみ取得
bash ~/stackchan.sh --logs --seconds 90 --yes
```

`bootNetwork=skipped bootOffline=selected bootNetworkReason=offline-selected` と同じ起動sequenceで `phase=ready` が観測されれば、オフライン選択からのアプリ起動を確認できます。`usb-only` はWi-Fi接続失敗によるオフライン選択と区別します。ネットワークがfailedのままreadyに達した場合も、未接続でローカル起動できた結果として区別して報告します。公式Face・タッチ操作は別途確認します。資格情報を消して試験しません。

push前のローカル修正を使う際は `--PR` を付けません。`--PR 92` はGitHub側のコードから別の統合worktreeを選ぶため、未pushの修正は含まれません。


標準の本体起動では、Wi-Fi接続失敗時に選択画面を出さず自動でオフライン起動します。既定の上限は3試行×各20秒、試行間500msで、失敗がタイムアウトの場合は約61秒以内（スケジューリング等を除く）にローカル起動へ進みます。設定なしは試行を繰り返しません。保存済み資格情報は変更せず、設定画面から再接続できます。

新しい証拠は `phase=ready bootNetwork=skipped bootOffline=automatic bootNetworkReason=automatic-offline` です。USB専用起動の分岐は従来どおり別扱いです。この判定はWi-Fi接続結果であり、Wi-Fi接続後のインターネット疎通を検査するものではありません。

### XiaoZhiなどの音声ログ（会話本文は保存しない）

```bash
# tmux内。既存のログ排出を有効化して90秒収集。RSTを押さずに実行する
bash ~/stackchan.sh --logs --audio --seconds 90 --yes
```

`--audio` は `--logs` 専用で、書込・`--all`・USB復旧とは併用できません。開始時に一意な実行フォルダを作成し、同一本体のVID/PID・シリアル・物理ポートと占有状態を確認します。hubが元からactiveの場合のみ一時停止・復帰します。

認証済み `/debug/status` の読取りだけを最大2秒に1回行います。同時要求は1件までで、5秒応答がなければ停止します。このRPCも同じVM上で処理するため、VM停止を回避・復旧するものではありません。`/status`・ファイル走査・AIモード切替・会話本文ログの有効化・撮影・再生要求・自動RST要求は送りません。認証値は引数やログへ出しません。USB切断後は同一性が合う本体だけを再検出し、診断の読取り以外は再送しません。

保存先は実行フォルダの `audio-logs.log`。会話本文・認証情報・任意のエラー本文は除外し、次だけを許可します。

- `[audio-state]`: TTS開始/終了、ASRイベント数、返答テキスト確定、出力open/close、drain開始/完了、マイクopen、失敗・切断、2秒に1回の再生health。
- event時刻`ms`、session、TTS開始ごとのturnとdrain開始時のdrainTurn、provider（1=XiaoZhi、2=Gemini、0=その他/未特定）、state/previousState（SDK: 4=マイク送信、5=音声受信、6=終了待ち、-1=失敗）、head/tail、pending/queuedBytes、累積pcmBytes、underruns、maxPumpGapMs、drainUntil/hardwareUntil、resuming。
- failureKindは0=未分類、1=接続系候補、2=メモリ系候補、3=音声系候補。エラー文の定型分類であり、根本原因の確定ではありません。
- 既存の数値Opus統計、再生キュー不足カウンタ、数値の内部RAM/PSRAM snapshot、定型の未要求音声抑制通知。
- `[audio-status]`: 本体ログリングのqueued/dropped/truncated/usbRetries。欠落カウンタも確認してください。

旧ファームウェアでも残っているOpus/再生不足のログは取得できます。新しい`audio-state`の詳細は、診断追加版を本体へ書き込んだ後から記録されます。過去の会話を新しく復元する機能ではありません。既存リングログのPC受信時刻と、本来の発生時刻は異なる場合があります。新しいイベントには本体側でハンドラを処理した時点のms/sessionを含めます（サーバー送信時刻ではありません）。ホスト側Git SHAだけで本体のビルドを判定しません。

0件・正常終了は会話成功を意味しません。XiaoZhiの再生状態競合（#93）を直す変更は含めず、次TTS開始時にstate=6のままか、tts-stop前にdrain完了・mic-openが起きるかを観測するための診断です。

音声採取中のI/O例外は `USB transport stage=open|write|read type=... errno=...` として記録し、例外本文は保存しません。errno=0はエラーがなかった意味ではなく、例外にerrnoがないことを表します。例外後も同一本体が列挙されている場合は、その場で停止して再オープン・再送をしません。認識から消えた場合だけ、指定した収集時間内で同一本体の再出現を待ちます。USB I/Oエラーだけで物理切断・本体クラッシュとは断定しません。


USBは開くがwrite timeoutの場合、接続設定の比較として `bash ~/stackchan.sh --logs --audio --dtr on --seconds 15 --yes` を明示指定できます。DTR=on/RTS=offは既存Hubと同じ設定で、ポートを開く前に設定します。開いた後の信号切替・RTSパルスは送りません。既定DTR=offは維持します。USB-Serial/JTAGのDTR/RTSはリセット制御にも関わるため、あらゆるOS/ドライバ環境でオープン時のリセットが起きないと保証するものではありません。同じwrite timeoutなら再オープンを繰り返さず停止します。この比較だけで本体故障・設定原因・復旧成功と断定しません。
