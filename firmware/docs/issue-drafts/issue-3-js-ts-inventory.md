# Issue #3: JS/TS移行の依存関係と実機互換性を整理

> **Status: Draft / design only.** 本PRでは仕様・実装順序を記録する。ファームウェア、SQLite、GPIO、設定、実機には一切変更しない。

## 目的と境界
archive-*.js を一括変換せず、実際の依存グラフを根拠に移行可否を決める。

## 既存の調査候補
- `firmware/host/app/archive-*.js`
- `firmware/host/app/manifest.json`
- `firmware/tsconfig.json`
- `firmware/host/app/archive-volume.js`
- `firmware/host/app/volume-preview.ts`

## 後続コミットの実装ステップ
1. ファイルごとのimport/export・native・Worker・Cバインディングと逆依存を列挙する
2. Node/Moddable/ESP32それぞれの解決規則を確認し、JSを維持すべき例外を記録する
3. 機能単位の小PRへ分割し、型定義とmanifest差分を確定する

## 回帰テストと受入条件
- [ ] 現行テスト/ビルドの基準値
- [ ] 型チェック・manifest検証・CoreS3ビルド
- [ ] 音声・カメラ・公式Faceを維持する実機回帰

## 依存関係と安全性
調査完了まではJS拡張子の変更なし。

- **Read-only First:** ソース・実データ構造・保存先の確認から着手。実データと秘密情報はGitHubへアップロードしない。
- **Idempotency:** 移行や保存が必要な場合は再実行安全性、既存行との整合性、途中失敗復旧を先に設計。
- **Rollback:** 対象ファイル/DBのバックアップと逆移行可否を実装前に確定する。実機のフラッシュ書込みは本PRに含めない。
- **Acceptance:** CI、CoreS3ビルド、実機確認の結果が揃うまでDraftを維持し、関連Issueを自動Closeしない。

Issue: https://github.com/messpy/stack-chan/issues/3
Base: `stackchan-super`


## 2026-11-08 追補: 実行可能な依存監査（未移行）

`firmware/scripts/archive-js-inventory.mjs` を追加。**ソースのみ読み取り**、`archive-*.js` のファイル名・行数・静的import候補・依存先・native/Worker/Piu/機器アクセスのフラグをJSONで標準出力する。

```bash
# kmacのcloneで事前調査。何も変更しない
cd /mnt/data/Development/stackchan/stack-chan/firmware
node scripts/archive-js-inventory.mjs
node --test scripts/lib/archive-js-inventory.test.mjs
```

監査の重要な区別:
- `archive-memory.js` は `native('xs_archive_database')` を使用。C/SQLiteへの依存を取り除かず、型宣言を先に作る。
- `archive-gemini-worker.js` は音声Worker側の実装。MainとWorker間のプロトコル互換を独立検証する。
- `archive-screen.js` / `archive-usb.js` は manifest 上でCファイルと組。JSだけを改名してはならない。
- `archive-direct-chat.js` は複数プロバイダーの音声・ツール・撮影呼出しを集約。最終段階までJS維持が安全。
- このスクリプトは正規表現の**語彙解析**であり、実際の`manifest` エイリアス、動的import、XSホスト関数の完全な依存グラフではない。レポートの `unresolvedArchiveImports` を直ちに欠陥と解釈しない。

**状態:** スクリプトとNodeテストを追加したが、全52ファイルのリスク評価・ビルド・実機検証は未完了。JS→TSの実変換はこのPRではしない。
