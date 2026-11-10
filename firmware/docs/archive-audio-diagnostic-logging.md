# Archive/XiaoZhi 音声経路の診断

## 目的

字幕は表示されても音声が出ない、TTSが一度も始まらない、再生途中で切れる、
接続が閉じる場合でも、マイクから出力まで最後の観測段階を特定する。
この変更は音声障害そのものの修正を約束するものではない。

依存元: PR #95（連続TTSと再生終了待ちの競合）。
診断PRは #95 のHEADを起点とする。実機での受入が終わるまで
#93/#94の問題を解決済みとは扱わない。

## 記録項目

音声イベントは [audio-path] stage=... key=value の1行形式。
発話本文・PCM/Opusデータ・認証情報は記録しない。
WorkerからメインVMへ audioDiagnostics メッセージを送信するので、
メインVMのUSBリリースログに残る。

| stage | 内容 | 注意 |
| --- | --- | --- |
| mic | start、snapshot、output_handoff、release、callback_failed。callbacks、capturedBytes、forwardedBytes、ignoredBytes、oversizeBytes、emptyReads、readFailures | forwardedBytesは処理試行量。サーバー到達とは別 |
| upload | connect、hello、listen_start、heartbeat、tts_start、failed、close。encoderReady、capturedPcmBytes、droppedPcmBytes、encodedPackets、attemptedSendBytes | TTS未開始でも2秒ごと。nullは未計測、0は計測済みのゼロ |
| transport | open、close_frame、socket_close、error、backpressure。closeCode、reasonLength、queuedBytes、socketState、submittedSocketBytes、droppedNoSocketBytes | 理由本文は保存しない。submittedSocketBytesはテキストも含み、到達保証ではない |
| asr | final、textChars | 認識本文なし |
| tts | start、sentence_start、stop、turn、textChars | 発生しなかったことも診断材料 |
| decode | fragments、skipped、decoded、failures、pcmBytes | デコーダ初期化前は別途helloやuploadと照合 |
| output | start、submittedBytes、completedBytes、completedChunks、failures、pending、drained | native完了はDAC出力/聴感上の再生完了とは別 |
| heap | nativeStackMinimumFree、internalFree、internalMinimum、internalLargest、psramFree | USB診断が有効なとき30秒周期 |

## kmacでの採取

USBへの書き込みは行わない。対象ファームウェア書き込み後に採取する。
先に bash ~/stackchan.sh --check でUSB同一性を確認。
既存のminitermやUSB診断がポートを占有していないことを確認。
Ctrl+] でminiterm終了。

~~~bash
clear
cd /mnt/data/Development/stackchan/stack-chan/firmware || exit 1
logdir=$(mktemp -d "$HOME/stackchan-audio-log.XXXXXX") || exit 1
echo "[INFO] LOGDIR=$logdir"
python3 -m serial.tools.miniterm /dev/ttyACM0 115200 --raw 2>&1 |
  node scripts/lib/archive-audio-log-collector.mjs \
    --raw "$logdir/serial.raw" \
    --full "$logdir/reconstructed.log" \
    --events "$logdir/diagnostics.jsonl" \
    --summary "$logdir/summary.json"
~~~

- serial.raw: USBストリームを無加工で保存。秘匿情報が含まれる可能性があるためIssueにそのまま添付しない。
- reconstructed.log: 分割されたdebugフラグメントを再構成。未知タグを含む全行を残す。ローカル専用。
- diagnostics.jsonl: 数値と限定された識別子のみを抽出した解析用ログ。
- summary.json: 原本バイト数、復元件数、構文不正件数、未完フラグメント、USBリング統計。

USBリング自体で既に失われた記録は復元できない。
イベント0件をネットワーク・音声経路の活動0件と混同しない。

## 原因切り分け例

- mic capturedBytes>0、upload encodedPackets=0: PCMリング/エンコーダを調べる。
- upload encodedPackets>0、socketQueueBytes増加: バックプレッシャーの可能性。
- ASR finalあり、tts startなし: クラウド応答・制御メッセージ受信を調べる。
- decode decoded>0、output submittedBytes=0: ネイティブへの引き渡しを調べる。
- output completedBytes>0で無音: 音量、アンプ、DMA、I2Sを調べる。

## 自動テスト

~~~bash
cd /mnt/data/Development/stackchan/stack-chan/firmware || exit 1
node --test scripts/lib/archive-audio-log-collector.test.mjs
node --experimental-vm-modules --test scripts/lib/archive-xiaozhi-playback-lifecycle.test.mjs
~~~

GitHub Actions Archive audio observability でも同じ検証を行う。
CoreS3の実機で、通信/マイク/出力とUSBリングを確認するまで最終受入とはしない。
