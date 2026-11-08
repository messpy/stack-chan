# Issue #8: 人物プロフィールと履歴の共通AIコンテキストを設計

> **Status: Draft / design only.** この差分は実装を始めるための計画書のみ。機能・SQLite・設定・本体の変更はない。

## 目的・境界
人物を識別した時点で、プロバイダー間で一貫したプロフィール・直近履歴・日時を適切に共有する設計。

## 監査対象（コードから今後検証する場所）
- `firmware/host/app/archive-memory.js`
- `firmware/host/app/archive-direct-chat.js`
- `firmware/host/app/archive-ollama.js`
- `firmware/host/app/archive-gemini-worker.js`

## 変更を加える前の手順
1. XiaoZhi、Gemini音声/テキスト、Ollamaの接続・指示再送タイミングを列挙する
2. getConversationContext(userId, options)の型・上限・明示的な匿名/ゲスト扱いを決める
3. 人物確定後の既存セッションに再適用できる経路と、未対応時の表示を定義する

## 合格条件・回帰テスト
- [ ] 識別前後・接続復旧時の人物・履歴整合性
- [ ] 異なるプロバイダーが同じ情報を使い、未対応の機能を誤申告しないこと
- [ ] プライバシー・トークン/RAM上限・履歴プロンプト注入の無害化

## 注意事項
- 依存関係: #4/#5/#6のID設計、#2の時刻取扱と整合。
- Read-only First: 実データの構造と参照箇所を確認し、根拠のないテーブル削除・一括置換をしない。
- SQLite、暗号化設定、SDデータを変更する場合は完全バックアップ、データ件数・参照整合性、失敗時のロールバックを先に設計する。
- プライベートmanifest、Wi-Fi認証情報、AIキー、声/画像/会話内容をGitHubへコミットしない。
- 後続コミットでソース・テストを追加し、CI・CoreS3ビルド・実機試験が完了するまではDraftのままにする。

関連Issue: https://github.com/messpy/stack-chan/issues/8
