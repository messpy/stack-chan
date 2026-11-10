# Issue #17: KoeAct-JP CoreS3本体推論の統合計画

> **Draft / planning only.** 実装前の確認と合格条件を追跡する差分です。このコミットで本体機能、DB、設定、GPIO、Flashは変更しません。

## 目的と範囲
既存PR #18/#22のAction検証や単体ビルドと、未実装のCoreS3推論を分離する。既存STTへ安全にフォールバックする。

## 調査対象
- `firmware/host/app/archive-voice-command-policy.js`
- `firmware/host/app/archive-voice-control.js`
- `firmware/scripts/koeact-standalone-build.sh`
- `firmware/host/app/archive-direct-chat.js`

## 段階実装
1. 公式モデル/ライセンス/SHA/Flash配置と現行16MiBパーティション互換を監査する
2. ESP-DL推論・16kHz入力・Mel特徴・Action復元を本体側へ持ち込む責務を定義する
3. 音声所有権、内蔵RAM/PSRAM・モデル推論の実測基準と安全なfallbackを設計する

## 完了判定
- [ ] 既存XiaoZhi/Google STTが引き続き動く
- [ ] confidence不足/未知Action/誤発火で機器動作が起きない
- [ ] CoreS3単体で推論後にActionを復元・実行し、連続運用でRAMが枯渇しない

## 前提・安全
#18/#22の既存PRとは実装が重ならないよう段階統合。バイナリモデル・認証情報は同梱しない。

- 本文と実機実装の差分を継続追跡し、未実装のAPIを存在すると表示しない。
- Read-only Firstで依存・ピン・保存先を確認し、設定やデータを変更する前に影響範囲を明確化する。
- SD/SQLite/Flashへの変更時は完全バックアップ、再実行時の整合性検証、ロールバック手順を設ける。
- 秘密トークン、私有manifest、音声・写真、学習済み個人情報は公開しない。
- ユニットテスト、CI、CoreS3ビルド、実機検証のエビデンスが揃うまでDraftを維持する。

Issue: https://github.com/messpy/stack-chan/issues/17
