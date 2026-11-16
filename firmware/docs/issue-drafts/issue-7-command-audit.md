# Issue #7: 音声コマンド・AIツール実行の監査契約を定義

> **Status: Draft / design only.** 本PRでは仕様・実装順序を記録する。ファームウェア、SQLite、GPIO、設定、実機には一切変更しない。

## 目的と境界
コマンドを表示した事実と実際の実行成否を分離し、message_commandsへ一件ごとに記録する。

## 既存の調査候補
- `firmware/host/app/archive-direct-chat.js`
- `firmware/host/app/archive-tools.js`
- `firmware/host/app/archive-head-motion.js`
- `firmware/host/app/archive-memory.js`

## 後続コミットの実装ステップ
1. 直接head_moveとLLM toolの二経路を両方追跡する
2. requested/success/failed/pendingを分け、送信成功と物理動作成功を混同しない
3. 秘匿引数の除外、失敗の分類、再実行時の重複排除を設計する

## 回帰テストと受入条件
- [ ] 一発話から複数コマンドとAI/直接ツールの区別
- [ ] 失敗・再起動・重複時の不正な成功表示なし
- [ ] 監査ログへのAPIキー・音声全文混入なし

## 依存関係と安全性
#6ターンIDを基準に設計。

- **Read-only First:** ソース・実データ構造・保存先の確認から着手。実データと秘密情報はGitHubへアップロードしない。
- **Idempotency:** 移行や保存が必要な場合は再実行安全性、既存行との整合性、途中失敗復旧を先に設計。
- **Rollback:** 対象ファイル/DBのバックアップと逆移行可否を実装前に確定する。実機のフラッシュ書込みは本PRに含めない。
- **Acceptance:** CI、CoreS3ビルド、実機確認の結果が揃うまでDraftを維持し、関連Issueを自動Closeしない。

Issue: https://github.com/messpy/stack-chan/issues/7
Base: `stackchan-super`
