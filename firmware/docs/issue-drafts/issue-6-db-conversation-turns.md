# Issue #6: 会話ターンIDと返信関係の保存契約を設計

> **Status: Draft / design only.** 本PRでは仕様・実装順序を記録する。ファームウェア、SQLite、GPIO、設定、実機には一切変更しない。

## 目的と境界
user inputからassistant replyまでを一意のturn_idとnullableなreply_to_message_idで関連付ける。

## 既存の調査候補
- `firmware/host/app/archive-memory.js`
- `firmware/host/app/archive-direct-chat.js`

## 後続コミットの実装ステップ
1. STT部分結果/確定結果・割込み・再接続時の識別子寿命を定める
2. 1入力対多出力・無応答・ツール呼出を表現するDDL/APIを定義する
3. 過去メッセージの関連IDをNULLとして保つ移行仕様を作る

## 回帰テストと受入条件
- [ ] 同時ターン・取消・再接続・部分STTの誤関連防止
- [ ] 1対多の回答とツール結果の参照整合性
- [ ] 再起動後の履歴表示と旧DB互換

## 依存関係と安全性
#5の参加者セマンティクス決定後に移行。

- **Read-only First:** ソース・実データ構造・保存先の確認から着手。実データと秘密情報はGitHubへアップロードしない。
- **Idempotency:** 移行や保存が必要な場合は再実行安全性、既存行との整合性、途中失敗復旧を先に設計。
- **Rollback:** 対象ファイル/DBのバックアップと逆移行可否を実装前に確定する。実機のフラッシュ書込みは本PRに含めない。
- **Acceptance:** CI、CoreS3ビルド、実機確認の結果が揃うまでDraftを維持し、関連Issueを自動Closeしない。

Issue: https://github.com/messpy/stack-chan/issues/6
Base: `stackchan-super`
