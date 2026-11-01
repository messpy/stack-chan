# 2026-11-01: 名前確定後に字幕・タッチ・USBが同時停止

ユーザー実行の更新は成功し、ログはconversation_identify成功、字幕受信の後に途絶えた。USBも繰り返しタイムアウトした。

内蔵USB JTAGと、実機に書き込まれたビルドのELFで確認した停止スタック:

- main: xQueueGenericSend → modMessagePostToMachine → fxQueuePromiseJobs → fxQueueJob / fxPromiseThen
- archiveGeminiLi: xQueueGenericSend → modMessagePostToMachine → Worker.postMessage

ESP32のリリースSDKではメッセージ投稿の待ち時間がportMAX_DELAY。mainが自分の満杯のキューへPromiseジョブを送ろうとすると、受信側自身が待ち続ける。キュー長の増加だけでは解決しない。DB検索の時間上限とは別の問題。

`patch-promise-checkpoint.py` はESP32でPromiseジョブを同じキューへ投稿せず、modMessageServiceの安全な区切りで保留ジョブを実行するようにSDKを修正する。保留ジョブがある間は待機時間を0にし、後続ジョブは次の処理周期で続行する。他のプラットフォームの予約方法は維持する。SDKの既存ソース・ライセンス表示は維持し、未対応の実装変更時は停止する。

更新シェルがSDK環境読み込み後にパッチを適用する。通常のビルド出力を利用し、distの直接編集はしない。直接npm build:archiveを実行する場合は先に `python3 scripts/patch-promise-checkpoint.py` を実行すること。

ホスト回帰テスト:

```sh
MODDABLE=/mnt/data/Development/stackchan-sdk/moddable python3 scripts/test_promise_checkpoint.py -v
python3 scripts/test_update_status.py -v
```

前者は実際の修正済みSDK関数をCハーネスへ組み込み、満杯キューでの非ブロック、Promise維持・実行、空キューでの待機、次周期への引き継ぎを検証する。ESP32でのビルド・実機確認の代わりにはならない。

本体確認: 更新後、名乗る → 名前確定 → 返答終了 → 聞き取り復帰 → 顔タップ・会話中ボタンが応答すること。USBステータス問い合わせも応答し続けること。現時点はユーザー実行待ち。
