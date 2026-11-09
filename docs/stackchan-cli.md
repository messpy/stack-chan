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
```

- 複数指定は確認→テスト→ビルド→書き込み→ログの順です。`--all` は確認・テスト・ビルド・書き込み・起動ログ取得。撮影・会話の自動試験は含みません。
- `--write` / `--all` はtmux内で実行。本体を手動ダウンロードモードにした後、16MiBバックアップの読取りと書き込みを別々にyes/no確認します。自動リセットは行いません。書き込み後はログ取得中に本体RSTを短く押してください。
- `--write` はテストやビルドを再実行しません。この入口で作成したビルド証跡が必要です。初回は `--build` を実行してください。ソース・SDK・元設定・成果物が変わった場合は書き込みを拒否します。証跡は `firmware/dist/stackchan-build-receipt.json`。
- `--test` は既存UnitとArchive回帰テストを実行します。`--build` は公式 `build:archive:m5stackchan_cores3` を実行します。元private manifestを保護し、生成用設定は終了時に元に戻します。
- `--logs` はUSB関連カーネルログと許可された起動phase/resetログを取得。シリアルを開く前に確認します。hubがactiveなら、追加確認後に停止して終了時に復帰。元から停止中なら起動しません。USB切断時は同一VID/PID・シリアル・物理ポートだけを再検出し、要求は再送しません。
- 無関係な通信・会話・認証情報はUSBログに保存しません。例外詳細本文は省略します。ログが空でも成功とは判定しません。生のテスト/ビルド出力やフラッシュバックアップは秘密を含み得るため、実行フォルダは非公開で保持し、そのままGitHubへ貼らないでください。
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
