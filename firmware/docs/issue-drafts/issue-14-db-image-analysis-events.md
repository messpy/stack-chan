# Issue #14: 画像保存・AI送信・解析結果の履歴を分離設計

> **Draft / planning only.** 実装前の確認と合格条件を追跡する差分です。このコミットで本体機能、DB、設定、GPIO、Flashは変更しません。

## 目的と範囲
画像添付の存在とAI画像解析の各試行・結果を分けて記録し、送信成功を捏造しない。

## 調査対象
- `firmware/host/app/archive-memory.js`
- `firmware/host/app/archive-vision.js`
- `firmware/host/app/archive-xiaozhi-vision.js`
- `firmware/host/app/archive-direct-chat.js`

## 段階実装
1. message_mediaの旧1:1構造とphotoHandler/vision結果の関連IDを確認する
2. media_analysisのrequested/sent/complete/failed等の状態遷移をプロバイダーごとに定義する
3. 画像自体はSDに残し、SQLiteに参照・状態だけ記録する互換APIを設計する

## 完了判定
- [ ] 未送信/未設定/busy/タイムアウト/成功の区別
- [ ] 1画像に複数解析、再実行、過去データ不明状態
- [ ] SD画像削除・履歴削除・機密保護・再起動

## 前提・安全
#6ターンID/#9実行メタデータと重複登録しない。

- 本文と実機実装の差分を継続追跡し、未実装のAPIを存在すると表示しない。
- Read-only Firstで依存・ピン・保存先を確認し、設定やデータを変更する前に影響範囲を明確化する。
- SD/SQLite/Flashへの変更時は完全バックアップ、再実行時の整合性検証、ロールバック手順を設ける。
- 秘密トークン、私有manifest、音声・写真、学習済み個人情報は公開しない。
- ユニットテスト、CI、CoreS3ビルド、実機検証のエビデンスが揃うまでDraftを維持する。

Issue: https://github.com/messpy/stack-chan/issues/14


## 2026-11-08: 撮影と画像解析の現在の契約

`stackchan-super` のソースで確認:
- `lan-archive.js` の `photo()` は`camera.capture`→JPEG化→SD保存後、`args.analyze!==false` のとき `describeImage()` を呼ぶ。
- `describeImage()` は入力/結果の両方を`archiveTranscript()`で保存しているが、**画像解析試行ごとの状態レコードは作っていない**。
- `archive-vision.js` の`analyzeJPEG()` は `busy` / `unconfigured` / `complete` / `error` を返し、最後の結果はメモリ上にある。送信が開始されたかは現状レスポンスの`complete`と混同しない。
- `archive-memory.js` は `message_media(message_id,filename)` を保存する。解析試行が成功したか否かを表すカラム/別テーブルはない。

従って新規`media_analysis`は、撮影成功・SD保存成功・プロバイダー送信要求・応答完了を**別々のイベント**として扱う。旧行に対して`sent=true`を推定補完しない。既存写真の全削除やメッセージID変更は行わない。

**未実施:** 実SQLiteデータ監査、画像解析メタデータ保存、移行テスト、実機撮影 (#33/#40)。
