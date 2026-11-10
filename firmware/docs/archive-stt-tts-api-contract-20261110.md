# Archive: STT / LLM / TTS API経路の統合仕様 (2026-11-10)

状態: **設計案・未実装**。カテゴリPR #99で整理し、実装と実機受入は別判定とする。

## 既存の再利用可能モジュール
- STT: `firmware/host/modules/audio/stt-whisper.ts` は既にHTTPS multipartを送信できる。ただし現在の `archive-direct-chat.js` に独立した選択肢として完全接続されているわけではない。
- TTS: `tts-openai.ts`, `tts-voicevox.ts`, `tts-elevenlabs.ts`, `tts-local.ts`, `stackchan-voice/tts-stackchan-voice.ts` がある。現在のArchive音声会話はXiaoZhi/Gemini専用経路との資源所有権が別である。
- XiaoZhi/Geminiのストリーミング経路を削除しない。変更は設定ベースで段階的に切り替える。

## 目標のパイプライン
```text
MIC/AudioIn -> VAD/record -> STT API -> final text -> LLM API
  -> TTS API -> audio stream -> decode -> PCM queue -> AudioOut/DMA
                                      +-> next microphone turn after drain
```
- providerは STT と TTS で独立選択。例: STT=Whisper API、LLM=Gemini/Ollama、TTS=VOICEVOX LAN API。
- provider: `api` / `xiaozhi` / `gemini` / `on-device` の対応表を明示し、未対応の組合せは起動前に拒否する。
- 同じdevice音声ownerを同時に二者へ渡さない。キャンセル後に旧セッションのcallbacksが現行セッションを操作しない。
- 音声発話中に撮影要求が来た場合は**既定ではキュー**。音声終了とnative出力解放、最低限のヒープ条件を確認してカメラへ切り替える。明示割込のみ途中停止。

## API契約
- STT: 設定済みHTTPS endpointへの multipart WAV/Opus（対応を事前チェック）、最大録音長・bodyサイズ・HTTP status・timeoutを制限。OpenAI Whisper形式の `text` を扱う既存実装を優先再利用。
- TTS: provider別にリクエスト形式とvoice/format/sample-rateを検証。WAV/PCMをストリーミング解読し、巨大な完成音声を内部RAMへ丸ごと保持しない。
- VOICEVOX: `/audio_query` → `/synthesis` という2段APIを扱う。LAN上の信頼済みホストだけ設定可能にする。
- 401/403/429/5xx、切断、空のレスポンス、音声フォーマット不正、timeout、cancel、復帰を区別する。
- 認証鍵・transcript本文・音声payloadはログに出さず、設定領域へ保存する。

## 診断イベント（全経路共通）
必須: `sessionId`, `turnId`, `requestId`, `stage`, `event`, `monoMs`, `provider`, `status`。
計測可能な場合: `durationMs`, `bytesIn`, `bytesOut`, `frames`, `queueBytes`, `droppedBytes`, `heapFree`, `heapLargest`, `failureCode`。
未測定値は `null`、測定値ゼロは `0` とし、存在しないカウンタを推測で作らない。

ステージ:
1. mic-acquire, mic-capture, mic-release
2. stt-api-start, stt-api-response, stt-final, stt-failed
3. llm-api-start, llm-first-token, llm-final, llm-failed
4. tts-api-start, tts-api-headers, tts-first-audio, tts-api-complete, tts-failed
5. decode, playback-enqueue, playback-complete, dma-drain-estimate, microphone-resume
6. photo-queued, audio-handoff, photo-start, photo-complete/photo-failed, handoff-resume

- 無音、STTが返らない、TTS開始前の切断でもstageを発火する。2秒周期のheartbeatは転送中の経路状態を数値で表示する。
- RAW USB原本と再構成ログを両方保存し、USBの取りこぼし/フラグメント欠落があれば記録する。
- `playback-complete` はアプリ側で出力を渡したことを指し、スピーカーが全サンプルを実際に発音した保証とは区別する。
- public Issueに添付するのは認証情報と本文を取り除いたサニタイズ済みログだけ。

## フォールバック
1. 主STT/TTS API成功なら選択中の会話を維持。
2. API失敗時は、設定したローカルproviderの利用条件（メモリ、モデル、認識言語）を確認。
3. 本体単体のローカル認識が利用不能なら、内蔵コマンド/固定音声を使い、音声認識できたかのように返答しない。
4. オフライン中の無限再接続・メモリ圧迫ループを禁止し、recoverableエラーをユーザー向けUIにも表示。

## マージ条件
- 既存PR #91/#95 の出力競合と #90 のカメラ割込競合を解決。
- archiveユニット・新しいAPI contractテスト・CoreS3ビルド・10往復・TTS途中失敗・ネット切断・撮影キューの実機テスト成功。
- 本体Face・データ・設定・SD・認証情報を保全。ユーザーの確認なしに実機書込みしない。
