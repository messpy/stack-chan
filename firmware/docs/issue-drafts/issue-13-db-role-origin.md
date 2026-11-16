# Issue #13: ロボット分離後のmessages.roleと送信者識別を設計

> **Draft / planning only.** 実装前の確認と合格条件を追跡する差分です。このコミットで本体機能、DB、設定、GPIO、Flashは変更しません。

## 目的と範囲
assistant・user・system・toolのroleと会話相手IDを区別し、旧stackchan-selfの履歴を無損失で保持する。

## 調査対象
- `firmware/host/app/archive-memory.js`
- `firmware/host/app/archive-direct-chat.js`

## 段階実装
1. role、speaker_id、message_contextの旧レコード実態を確認する
2. 本体1台・複数台、ゲスト・複数人のID対応表を決定する
3. 発話者IDと会話相手IDの参照更新と互換migrationを段階設計する

## 完了判定
- [ ] 既存ユーザー/assistant/tool履歴の検索同等性
- [ ] 話者途中切替・複数人・null帰属・再起動を網羅
- [ ] 旧stackchan-self行が消えないこと

## 前提・安全
#4/#5/#11と統合し、roleを単なるuser_idに置き換えない。

- 本文と実機実装の差分を継続追跡し、未実装のAPIを存在すると表示しない。
- Read-only Firstで依存・ピン・保存先を確認し、設定やデータを変更する前に影響範囲を明確化する。
- SD/SQLite/Flashへの変更時は完全バックアップ、再実行時の整合性検証、ロールバック手順を設ける。
- 秘密トークン、私有manifest、音声・写真、学習済み個人情報は公開しない。
- ユニットテスト、CI、CoreS3ビルド、実機検証のエビデンスが揃うまでDraftを維持する。

Issue: https://github.com/messpy/stack-chan/issues/13
