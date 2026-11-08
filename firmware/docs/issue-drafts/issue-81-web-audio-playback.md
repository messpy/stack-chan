# Issue #81: ブラウザから音声ファイルを送信し本体で再生

> **Draft / planning only.** このPRではWeb UIやファームウェアを変更しません。

## 確認済みの再利用箇所
- `firmware/host/app/archive-web.js`：認証付き `POST /rpc`（HTTP本文上限あり）
- `firmware/host/app/lan-archive.js`：`/speak-begin`, `/speak-chunk`, `/speak-play`, `/speak-cancel` 既存RPC
- `firmware/host/app/archive-audio-upload.js`：チャンク整合性チェック
- `firmware/host/app/archive-web-page.js`：本体LAN操作画面
- 類似のPR #43はアラーム・タイマー音設定用MP3/WAVアップロードであり、**任意ファイルを即時本体再生するUIは別要件**。

## 段階実装
1. 既存`robot.audio.playAudio(buffer)`のサポートするWAVサンプリング周波数・量子化・チャンネルを確認。
2. ファイル選択→形式/サイズ検証→認証付きチャンク送信→本体再生のWeb UIを設計。現在の20KB HTTPボディ上限を尊重し、チャンクを上限以下に制限。
3. 音声データ全体をRAMに確保する旧方式の危険性を調査し、連続RAMを大量消費する設計を避ける。上限とSD保存方式の可否を決める。
4. アラーム/TTS/AI会話/マイクと再生排他を保証し、busy時は音声を中断せず拒否する。
5. 開始/再生完了/エラー/取消の状態を分け、途中失敗ではセッションを確実に解放。

## 受入チェック
- [ ] Pixel/PCブラウザのファイル選択→StackChanスピーカーへ再生
- [ ] 非WAV、ヘッダー不正、巨大サイズ、チャンク欠損、リプレイ、通信切断を拒否
- [ ] 認証/Origin/CSRF保護、同時送信1件制限、任意SD書き込みなし
- [ ] RAM不足時に拒否し、公式FaceとAI会話を停止させない
- [ ] Node単体テスト、CoreS3ビルド、実機音響E2E

関連: #36 #40 #50、PR #43（機能境界を混同しない）。

**実装未着手／本体書き込みなし／Draft維持。**
