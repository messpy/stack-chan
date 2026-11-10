# Issue #9: STT・LLM・TTS処理メタデータの監査仕様を設計

> **Status: Draft / design only.** この差分は実装を始めるための計画書のみ。機能・SQLite・設定・本体の変更はない。

## 目的・境界
会話本文はmessagesに残し、処理の実行単位（provider/model/stage/attempt）を子テーブルで記録する。

## 監査対象（コードから今後検証する場所）
- `firmware/host/app/archive-direct-chat.js`
- `firmware/host/app/archive-memory.js`
- `firmware/host/app/archive-chat-audioio.js`

## 変更を加える前の手順
1. 既存プロバイダーごとの観測可能なstageと測れない項目を分類する
2. message_processingのstage/provider/model/status/elapsedと再試行IDを設計する
3. 観測データの保持期間、SD書込上限、権限、エラー文のサニタイズを決定する

## 合格条件・回帰テスト
- [ ] STT/LLM/TTS混在・再試行・フォールバックの実経路一致
- [ ] 未提供モデル名を捏造せずNULLとして記録
- [ ] APIキー・生音声・生トークンをDB・ログへ残さない

## 注意事項
- 依存関係: #6ターンIDと#7ツール実行ログの責任境界を分ける。
- Read-only First: 実データの構造と参照箇所を確認し、根拠のないテーブル削除・一括置換をしない。
- SQLite、暗号化設定、SDデータを変更する場合は完全バックアップ、データ件数・参照整合性、失敗時のロールバックを先に設計する。
- プライベートmanifest、Wi-Fi認証情報、AIキー、声/画像/会話内容をGitHubへコミットしない。
- 後続コミットでソース・テストを追加し、CI・CoreS3ビルド・実機試験が完了するまではDraftのままにする。

関連Issue: https://github.com/messpy/stack-chan/issues/9
