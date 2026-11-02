# 写真・動画・録音の削除と復元

「記録」タブのファイルごとの「削除」を押し、確認するとごみ箱へ移動する。「ごみ箱・復元」から元に戻せる。完全消去ではないため、ごみ箱内のファイルもSD/PCの容量を使用する。

本体LAN画面ではSDの`stackchan/`から`stackchan-trash/`へ移動する。会話の文章・人物プロフィール・DB・設定・アラーム音楽は対象外。PC画面では、SDへの移動成功後にPCのコピーと再生用MP4も非公開の`media/.trash/`へ移動する。LANから削除したファイルも、PC同期時にPC側のごみ箱へ移す。

復元は同名ファイルを上書きしない。削除・復元の再試行は、既に目的の場所に移動していれば成功とする。会話の文章と画像との対応情報は維持し、削除中は画像表示を省略する。復元後は再び画像を表示する。

ごみ箱一覧は50件ずつ表示できる。自動で完全削除する機能はない。

APIは既存のQR/Bearer/セッション認証とオリジン制限を利用する。

- 本体RPC: `/media/delete`・`/media/restore` (`name`)、`/media/trash` (`offset`, `limit`)
- PC: POST `/api/media/delete`・`/api/media/restore`、GET `/api/media/trash?offset=...`

テスト: firmwareで`npm run test:media-trash`、hubで`python3 -m unittest -v test_media_trash.py`。一時ディスクと仮想SDでファイル型制限、パストラバーサル拒否、復元、途中失敗の再試行、同名衝突、確認キャンセルを検証する。
