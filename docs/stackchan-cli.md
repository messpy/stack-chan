# StackChan 操作スクリプト

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

既定worktreeは `/home/kmac/work/stackchan-wifi-offline-review`。Node22、既存ESP-IDF6.1、既存Moddable SDK、元private manifestのパスは登録済みです。

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
