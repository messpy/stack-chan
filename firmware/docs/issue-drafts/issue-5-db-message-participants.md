# Issue #5: messagesの発話者と会話参加者を明確化

> **Status: Draft / design only.** 本PRでは仕様・実装順序を記録する。ファームウェア、SQLite、GPIO、設定、実機には一切変更しない。

## 目的と境界
role/speaker_id/message_context/user_idを混同せず、複数参加者の履歴を保持する。

## 既存の調査候補
- `firmware/host/app/archive-memory.js`
- `firmware/host/app/archive-direct-chat.js`

## 後続コミットの実装ステップ
1. 既存speaker_idとmessage_contextの多対多・ゲスト・assistantの件数を観測する
2. user_idを会話相手IDとして定義し、speaker_user_idが必要か決定する
3. message_contextの削除可否をデータ根拠に判定し、後方互換移行を設計する

## 回帰テストと受入条件
- [ ] 複数参加者・ゲスト・未識別の正しい帰属
- [ ] assistant発言とstackchan-selfの履歴互換
- [ ] 空・孤立・多重関連を含むDBの移行・ロールバック

## 依存関係と安全性
#4/#11/#13と協調。判定前にmessage_contextを削除しない。

- **Read-only First:** ソース・実データ構造・保存先の確認から着手。実データと秘密情報はGitHubへアップロードしない。
- **Idempotency:** 移行や保存が必要な場合は再実行安全性、既存行との整合性、途中失敗復旧を先に設計。
- **Rollback:** 対象ファイル/DBのバックアップと逆移行可否を実装前に確定する。実機のフラッシュ書込みは本PRに含めない。
- **Acceptance:** CI、CoreS3ビルド、実機確認の結果が揃うまでDraftを維持し、関連Issueを自動Closeしない。

Issue: https://github.com/messpy/stack-chan/issues/5
Base: `stackchan-super`
