# Issue #11: StackChan本体プロフィールと人物usersを分離設計

> **Status: Draft / design only.** この差分は実装を始めるための計画書のみ。機能・SQLite・設定・本体の変更はない。

## 目的・境界
stackchan-selfの過去履歴を維持したまま人物とロボットのプロフィールを分ける。

## 監査対象（コードから今後検証する場所）
- `firmware/host/app/archive-memory.js`
- `firmware/host/app/archive-direct-chat.js`
- `firmware/host/app/compose.ts`

## 変更を加える前の手順
1. entities.kind=robotとstackchan-self参照箇所を列挙する
2. stackchan_profileの最小スキーマと既存設定正本の重複を解消する
3. 旧assistantメッセージの参照整合性を維持した移行/逆移行手順を設計する

## 合格条件・回帰テスト
- [ ] 旧assistant履歴・人物一覧の表示互換
- [ ] 登録日不明値を捏造しないこと
- [ ] 公式の顔・声・人物識別と再起動を維持すること

## 注意事項
- 依存関係: #4のusers統合と#13のrole定義を同時設計。
- Read-only First: 実データの構造と参照箇所を確認し、根拠のないテーブル削除・一括置換をしない。
- SQLite、暗号化設定、SDデータを変更する場合は完全バックアップ、データ件数・参照整合性、失敗時のロールバックを先に設計する。
- プライベートmanifest、Wi-Fi認証情報、AIキー、声/画像/会話内容をGitHubへコミットしない。
- 後続コミットでソース・テストを追加し、CI・CoreS3ビルド・実機試験が完了するまではDraftのままにする。

関連Issue: https://github.com/messpy/stack-chan/issues/11
