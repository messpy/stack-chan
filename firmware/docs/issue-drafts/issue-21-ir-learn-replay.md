# Issue #21: CoreS3赤外線学習・登録・再送の統合計画

> **Draft / planning only.** 実装前の確認と合格条件を追跡する差分です。このコミットで本体機能、DB、設定、GPIO、Flashは変更しません。

## 目的と範囲
Unit IRの安全な配線確認後、オフラインRX/TX・登録信号の限定再送を実装。未登録コマンドや曖昧な音声では送信しない。

## 調査対象
- `firmware/host/app/archive-tools.js`
- `firmware/host/app/lan-archive.js`
- `firmware/host/app/archive-direct-chat.js`
- `firmware/host/platforms/m5stackchan_cores3`

## 段階実装
1. 外付けUnit IR・利用可能GPIO・電源電圧・サーボ/SDとの競合を実機確認する
2. ESP32-S3 RMT受信/送信と長さ上限付きraw/既知プロトコルを設計する
3. SD保存・登録UI・認証済みWeb操作・安全な固定音声コマンドを段階的に追加する

## 完了判定
- [ ] 3回受信一致・保存・再起動後のオフライン再送
- [ ] 未登録/不明瞭/否定/音声誤認識で送信しない
- [ ] 送信回数制限・電源/GPIO安全・長押し・家電の実動作は人が確認する

## 前提・安全
KoeAct-JP学習済みスキーマにはIRがないため#17/#18とは独立。必要ハードウェア入手は未確認。

- 本文と実機実装の差分を継続追跡し、未実装のAPIを存在すると表示しない。
- Read-only Firstで依存・ピン・保存先を確認し、設定やデータを変更する前に影響範囲を明確化する。
- SD/SQLite/Flashへの変更時は完全バックアップ、再実行時の整合性検証、ロールバック手順を設ける。
- 秘密トークン、私有manifest、音声・写真、学習済み個人情報は公開しない。
- ユニットテスト、CI、CoreS3ビルド、実機検証のエビデンスが揃うまでDraftを維持する。

Issue: https://github.com/messpy/stack-chan/issues/21


## 2026-11-08: IR固定コマンド・データ検証プロトタイプ

`firmware/scripts/lib/archive-ir-policy.mjs`（Node検証専用）とテストを追加。機器種別の限定、学習済みNEC/Rawの長さ・搬送波・リピート上限、明示登録された日本語フレーズの**完全一致**、曖昧一致拒否、二重登録拒否、500ms連打抑止を試験する。

```bash
cd firmware
node --test scripts/lib/archive-ir-policy.test.mjs
```

**ハードRMT受信/送信、SD永続保存、UI、音声モデル推論は未実装**。認識やAIが任意コードを生成して送信する経路は追加しない。対応家電・GPIO・電源の実機事前確認後のみ実装着手する。
