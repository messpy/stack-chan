# Issue #10: アラーム・姿勢・LED・表情の永続化先を整理

> **Status: Draft / design only.** この差分は実装を始めるための計画書のみ。機能・SQLite・設定・本体の変更はない。

## 目的・境界
Runtime state、再起動復元が必要な設定、監査イベントを分け、会話DBと暗号化Vaultに二重保存しない。

## 監査対象（コードから今後検証する場所）
- `firmware/host/app/archive-vault.js`
- `firmware/host/app/archive-tools.js`
- `firmware/host/app/archive-alarm-ui.js`
- `firmware/host/app/archive-head-motion.js`

## 変更を加える前の手順
1. 機能ごとの現在値・保存場所・復元タイミングを表へまとめる
2. remindersの1回/毎日/取消・停電復旧に必要な永続設定を列挙する
3. 高速に変わる姿勢・LED・顔のSDへの頻繁な記録は原則不要と定義する

## 合格条件・回帰テスト
- [ ] 停電・日時未同期後のアラーム復元と期限判定
- [ ] SD無し・Vault破損時の安全な機能縮退
- [ ] 設定保存頻度・容量・削除規約の確認

## 注意事項
- 依存関係: #12の設定正本を踏まえ、新DB追加の必要性を判断。
- Read-only First: 実データの構造と参照箇所を確認し、根拠のないテーブル削除・一括置換をしない。
- SQLite、暗号化設定、SDデータを変更する場合は完全バックアップ、データ件数・参照整合性、失敗時のロールバックを先に設計する。
- プライベートmanifest、Wi-Fi認証情報、AIキー、声/画像/会話内容をGitHubへコミットしない。
- 後続コミットでソース・テストを追加し、CI・CoreS3ビルド・実機試験が完了するまではDraftのままにする。

関連Issue: https://github.com/messpy/stack-chan/issues/10
