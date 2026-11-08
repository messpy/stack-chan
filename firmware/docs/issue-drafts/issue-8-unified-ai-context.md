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


## 2026-11-08: 現行コードの会話経路（再調査）

`stackchan-super` の `archive-direct-chat.js` / `archive-memory.js` を確認した事実:
- `conversationInstructions()` は `currentSpeaker()` からプロフィールを取り、`history({user_id,limit:3})` の**直近3メッセージ**を参考にする（3往復ではない）。本文は1件あたり240文字に縮めている。
- GeminiテキストとOllamaテキストの `[system,user]` プロンプトには `conversationInstructions()` が使われる。
- Gemini Liveは接続時 `instructions` を設定し、通常は同関数を使う。ただしOllama音声分岐には専用 `OLLAMA_SPEECH_INSTRUCTIONS` が渡される。話者切替後の同一接続への再投入可否は未検証。
- XiaoZhi接続の通常経路は`createXiaozhiV1Connection` とツール戻り値に依存する。実際にリモートAIへ情報が届いたかはエンドツーエンドで検証が必要。
- `archive-memory.js` の `identifySpeaker()` は`person`と`recent`を返し、識別時のプロフィール提供経路が別にある。Web会話入力を増やす #82 にも再利用するべき。

**不整合の候補:** 同じ文脈生成がテキスト/Live/音声で分散している。特に`OLLAMA_SPEECH_INSTRUCTIONS` がプロフィール参照を含まないケースの仕様を決定する。XiaoZhiは外部サーバーへ一律に同じsystem promptを適用できるとは限らない。既存プロバイダーの責務を先に調べる。

**次の実装設計:** `getConversationContext()` を境界とし、既存`person`・`recent`取得の上限、未識別/ゲストの最小化、時刻の有効性、秘密情報の除外、送信先ごとの可否をユニットテストで固定する。人物切替や接続再試行時には古いセッションの結果を捨てる。DBのJOIN変更はこのIssueの前提ではない。

**未実施:** 全providerの到達性E2E、メモリ実測、音声の会話プロンプト共有化。
