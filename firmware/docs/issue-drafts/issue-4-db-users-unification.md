# Issue #4: 人物プロフィールusers統合の移行契約を設計

> **Status: Draft / design only.** 本PRでは仕様・実装順序を記録する。ファームウェア、SQLite、GPIO、設定、実機には一切変更しない。

## 目的と境界
entities/profile_details/name_readingsを人物usersへ統合する設計を検討。created_atの過去値は捏造しない。

## 既存の調査候補
- `firmware/host/app/archive-memory.js`
- `firmware/host/app/archive-direct-chat.js`

## 後続コミットの実装ステップ
1. 既存SQLiteの人物・robot・VIEW・孤立参照・名前の読みを読み取り専用で調べる
2. user_id・created_at NULL・name_readingの移行対応表と旧API互換を決める
3. 移行前後の件数照合、失敗時トランザクション・バックアップ復元を設計する

## 回帰テストと受入条件
- [ ] 既存履歴・話者識別の検索同等性
- [ ] 新旧DBスキーマからの再起動と繰返し移行
- [ ] 保存失敗・書込途中停止時の復旧

## 依存関係と安全性
#11（ロボット分離）・#5（会話相手ID）と同じ正本を設計。

- **Read-only First:** ソース・実データ構造・保存先の確認から着手。実データと秘密情報はGitHubへアップロードしない。
- **Idempotency:** 移行や保存が必要な場合は再実行安全性、既存行との整合性、途中失敗復旧を先に設計。
- **Rollback:** 対象ファイル/DBのバックアップと逆移行可否を実装前に確定する。実機のフラッシュ書込みは本PRに含めない。
- **Acceptance:** CI、CoreS3ビルド、実機確認の結果が揃うまでDraftを維持し、関連Issueを自動Closeしない。

Issue: https://github.com/messpy/stack-chan/issues/4
Base: `stackchan-super`


## 2026-11-08: 実データ移行前の読み取り専用監査

`firmware/scripts/sql/archive-memory-readonly-audit.sql` を追加。対象は**本体稼働中のSDではなく、読み取り専用で退避したSQLiteの別コピーのみ**。人物、robot、`stackchan-self`、名前の読み、プロフィール、未参照の関係、多人数メッセージの件数を取り、データ内容・会話本文・氏名を表示しない。PRAGMA query_only=ONを利用し、スキーマ変更をしない。

結果を取るまでは`created_at`のバックフィルを行わず、`entities`等の旧テーブルと`user_profile` / `users` VIEWを削除しない。件数比較、旧参照、移行再実行/復旧の仕様を確定する。

**未実施:** 実SDデータの取得、sqlite3集計の実行、CoreS3ビルド、互換移行。機能実装ではない。
