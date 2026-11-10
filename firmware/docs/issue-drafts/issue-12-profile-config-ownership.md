# Issue #12: 人物・本体・暗号化設定の責任範囲を設計

> **Status: Draft / design only.** この差分は実装を始めるための計画書のみ。機能・SQLite・設定・本体の変更はない。

## 目的・境界
所有者・言語・人格・時刻・オフライン方針の正本を個別に決め、秘密情報はVaultから出さない。

## 監査対象（コードから今後検証する場所）
- `firmware/host/app/archive-vault.js`
- `firmware/host/app/archive-direct-chat.js`
- `firmware/host/app/archive-alarm-ui.js`
- `firmware/host/modules/preferences/loadPreference.ts`

## 変更を加える前の手順
1. 設定キーごとに既存正本、デフォルト、変更API、ローカライズを棚卸しする
2. owner_user_id未登録/変更/ゲストとプロフィール情報の適用範囲を決定する
3. AI指示へ渡すテキストを固定テンプレート化し、外部履歴を命令扱いしない

## 合格条件・回帰テスト
- [ ] オーナー未登録/変更、Wi-Fi未設定、Vault異常時に公式Faceを維持
- [ ] 機密設定が会話履歴・プログラムログに漏洩しない
- [ ] 設定変更・再起動・オフライン切替後に値が一貫する

## 注意事項
- 依存関係: #11本体プロフィールと#10保存先の同意を得てからスキーマ変更。
- Read-only First: 実データの構造と参照箇所を確認し、根拠のないテーブル削除・一括置換をしない。
- SQLite、暗号化設定、SDデータを変更する場合は完全バックアップ、データ件数・参照整合性、失敗時のロールバックを先に設計する。
- プライベートmanifest、Wi-Fi認証情報、AIキー、声/画像/会話内容をGitHubへコミットしない。
- 後続コミットでソース・テストを追加し、CI・CoreS3ビルド・実機試験が完了するまではDraftのままにする。

関連Issue: https://github.com/messpy/stack-chan/issues/12
