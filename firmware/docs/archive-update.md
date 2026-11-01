# CoreS3の更新

このPCでは、firmwareディレクトリから次の1コマンドで更新できます。

```sh
./scripts/update-archive.sh
```

Node・Moddable・ESP-IDFの環境を読み込み、npmの公式ラッパーで増分ビルド後、USB書き込みします。USBシリアル機器は本体1台だけを接続してください。書き込み中だけ、実行前に動作していたstackchan-hub.serviceを止め、失敗時にも再起動します。本体の再起動により、起動設定に応じて発声・会話開始する場合があります。

ビルドのみは `./scripts/update-archive.sh --build-only`。ログはGit対象外の `firmware/dist/update-logs/` に保存され、同時更新はロックで防ぎます。プライベートmanifestや認証情報を表示する処理はありません。ログはローカルで保管してください。

このPCのSDKパスを既定値にしています。別PCでは `STACKCHAN_NODE_BIN`、`STACKCHAN_XS_ENV`、`STACKCHAN_IDF_ENV` で変更できます。USB権限とsystemdユーザーセッションが必要です。古い生成物を毎回削除しないため、2回目以降は変更部分が中心のビルドになります。SDK・ネイティブコード変更時は時間がかかります。
