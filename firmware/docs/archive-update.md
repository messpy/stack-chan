# CoreS3の更新

このPCでは、firmwareディレクトリから次の1コマンドで更新できます。

```sh
./scripts/update-archive.sh
```

Node・Moddable・ESP-IDFの環境を読み込み、npmの公式ラッパーで増分ビルド後、USB書き込みします。USBシリアル機器は本体1台だけを接続してください。書き込み中だけ、実行前に動作していたstackchan-hub.serviceを止め、失敗時にも再起動します。本体の再起動により、起動設定に応じて発声・会話開始する場合があります。

ビルドのみは `./scripts/update-archive.sh --build-only`。直前に成功したビルドを変更せず再書き込みする場合のみ `./scripts/update-archive.sh --flash-only` を使えます。通常は引数なしで実行してください。詳細出力はログへ保存し、端末には進行と成否だけを表示します。ログはGit対象外の `firmware/dist/update-logs/` に保存され、同時更新はロックで防ぎます。プライベートmanifestや認証情報を表示する処理はありません。ログはローカルで保管してください。

このPCのSDKパスを既定値にしています。別PCでは `STACKCHAN_NODE_BIN`、`STACKCHAN_XS_ENV`、`STACKCHAN_IDF_ENV` で変更できます。USB権限とsystemdユーザーセッションが必要です。古い生成物を毎回削除しないため、2回目以降は変更部分が中心のビルドになります。SDK・ネイティブコード変更時は時間がかかります。


## ユーザー実行で更新する運用

今後、Codexは修正とテストを終えたところで「実行待ち」と伝えて停止します。ユーザーが明示的に書き込みを依頼した場合を除き、Codexがビルドの進行を何度も確認する運用はしません。

デスクトップの「StackChan 更新」を開き、Enterで開始します。端末は準備中・ビルド中・書き込み中・復帰中・成功/失敗を表示し、最後まで開いたままになります。「StackChan 更新.sh」も同じ起動用シェルです。

`firmware/dist/update-logs/latest.json` に最新の状態とログの絶対パスを原子的に保存します。`state` は `preparing`, `building`, `flashing`, `restoring`, `built`（ビルドのみ成功）, `succeeded`（書き込み成功）, `failed`。`exit_code`, `run_id`, `updated_at`, `needs_review` も含みます。電源断・強制killで途中の状態が残った場合は完了とみなさず、プロセスが残っているか確認してください。状態は `scripts/update-archive.sh --status` でも読めます。

完了したらこのチャットで「更新が終わった。ログ見て」と伝えてください。Codexはlatest.jsonを一度読み、該当ログの必要部分だけを確認します。書き込み成功は会話・タッチ・表示の実機検証成功を意味しません。端末は会話内容やAPIキーを含む可能性のある詳細ログを外部送信せず、状態ファイルにもコピーしません。

シェルはCodex CLI/APIを起動せず、ローカル処理だけで動作します。状態ファイルの変更でチャットが自動再開する連携は未設定です。

## 2026-11-01 マイク設定の修正（実行待ち）

ChatAudioIOのmono設定がCoreS3のstereo構成を上書きしていたため、archive manifestで16kHz・2ch入力を指定しました。入力ドライバーはstereoとして読み、Gemini workerのmonoPCMで16kHz・1chへ変換して送ります。次回更新後に、生成されたmc.defines.hのMODDEF_AUDIOIN_NUMCHANNELS=2を確認し、録音中5秒あたり約160000バイトのmono送信になるか（処理遅延分を考慮）をログで確認してください。設定変更によりネイティブ部分のビルドにも時間がかかる場合があります。
