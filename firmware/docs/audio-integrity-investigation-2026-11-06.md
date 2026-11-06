# CoreS3音声異常・無反応の調査

## 状態と境界

実機の「会話途中で電子的に崩れた声」はユーザー観測。発生時ログ・リセット情報がないため、今回の実機異音の原因は未確定。以下はコードで確認した欠陥とソフトウェア修正候補であり、音響改善の実機証明ではない。

元の `test/pr-integration-20261104` / `da8dbb48` は未コミット変更9ファイルと未追跡ファイルを保持したまま。専用worktree `.worktrees/audio-integrity`、ブランチ `fix/audio-integrity-20261105` を作成した。

GitHub確認時、#39 (`824f00de`)、#41 (`c8aee01b`)、#46 (`f3794923`)、#47 (`8b196517`) は全て未マージDraft。最新#47のheadを基点とし、#39/#41/#46のheadが祖先であることを確認した。本PRは#47に積み、#47の写真・文字起こし・旧private manifest互換性を保持する。`stackchan-super` へ直接マージしない。

実機USB、LAN、スピーカー、サーボ、電源は一切操作していない。ビルドにSDK内BLE生成物の更新権限を要したが、共有SDKソースへの音声パッチは適用していない。

## コードで確認した欠陥と変更

### 非同期再生のネイティブ競合

使用SDK `80076c48f5ab87ce29de728071b7408599071a12` の
`modules/io/audioout/esp32/audioout-esp32.c` では、`audiooutDeliver()` と
`audioOutLoop()` が双方で同じ `elements` / `position` / `bytesAvailable` を読んで
`doWrite()`し、カーソルを進める。キュー操作部には未実装のlockコメントがあり、
I2S書込みと共有 `stagingOffset` を含むトランザクションに排他がない。
同一PCM範囲の二重消費・位置更新の競合が可能。ISRも、メインが解放可能なノードを走査する。
これは音声破損に繋がり得る欠陥だが、今回の実機発生原因とは断定しない。

Archive専用 `stackchanAsyncAudioOut` をリポジトリ内に設けた。SDKの著作権・LGPL通知を保持し、
別native symbolとして登録する。既存private manifestが含む `server.manifest.json` を利用し、
private manifestの秘密情報や登録一覧を変更しない。

- enqueue、PCM読取り→I2S書込み→カーソル更新、完了unlinkをtask mutexで保護。
- ISRからノード走査を除去。DMA credit上限更新をCASにする。
- XS callbackとtask終了待機中にmutexを保持しない。closeフラグで通知上書きと古いcallbackを防御。
- GC rootは完了通知まで保持。constructor途中失敗ではremember解除とnative資源解放を行う。
- I2Sの成功応答でも書込み量が不足すればエラーをラッチし、後続PCMを流さない。
- 音量係数はwriteごとにatomic snapshot。音量値そのものは変更しない。

既存DMA auto-clearによる無音化、128KiBのPSRAMキュー、プリバッファリングを保持。
underrunだけを根拠に電子的な音声破損と判断しない。

### 再生セッション寿命

`configureAudio()` の基底実装はレート変更時にAudioOutを閉じるが、Archiveの再生Timer/queueは知らない。
旧queueの共有PCMコピーが未解放のままtimerに保持され得た。レート変更前に旧Timer/queueを終了する。
`ensureOutput()` はAudioOut生成後にqueue確保が失敗するとローカル変数の出力を閉じられなかった。
所有権を先に登録し、失敗時にreleaseする。未作成Timerも安全に扱う。
完了callbackの二重通知でスロットを二重に再利用しない。close後のcallbackは無効。

### 緑LEDと文字起こし送信

`recognitionOnly` の `stt()` と `tts(start)` は `abort()` で `uploading=false` にするが、同Worker上で再開しない。
メインがすぐにセッションを閉じる通常経路では隠れるが、通知遅延・後続TTS通知時に入力だけ動く状態が可能。
抑止後に `startListening()` を送る。通常会話の音声・tool抑止の条件は維持する。

従来の緑LEDはメインのPCMリング書込み時に点灯し、Worker送信停止と区別できなかった。
XiaoZhiではWorkerのupload有効状態と直近3秒以内のWebSocket音声受付実績を要求する。
送信停止通知・出力開始・closeで消灯する。これはサーバーASR成功の保証ではない。
既存20秒の無進捗検出/既存backoffを利用し、新たな自動再起動・無期限リトライは導入しない。

## 診断とコスト

既存の認証付き `/diagnostics`、`directChatStatus()`、PCの0600 JSONL収集を拡張。
`audio` にprovider、AudioIn/AudioOut/Worker状態、upload有効、最終PCM入力、最終socket音声受付、
最終ASR時刻、サンプルレート、PCM残量ms、native queue残量ms、underrun数、PCM overrun数/bytes、
再接続試行数、最終音声エラー分類、表示段階を追加する。

- PCM overrun数はmain→native PCM ringでチャンクを拒否された回数。bytesはnative encoder累計。
- underrunは既存plannerの推定starvation。ハードウェアDMA underrunの直接測定ではない。
- 最終socket受付はWebSocket APIが受け付けた時刻。クラウド到着のACKとは区別する。
- 入出力/Worker/再生数値は直近セッション、再接続数はこの起動中の初回以降の開始試行。
- `phase` は既存LED段階、`chat.state` と併せてASR/LLM待機/TTSを判断する。LLM進捗のサーバーACKではない。
- heapは既存 `heapSummary` の内蔵RAM空き/最大連続領域とPSRAMを別々に記録。
  既存preflight/cleanupに接続成立時のheap milestoneを追加。保護閾値112KiB/24KiBは変更しない。
- Worker→mainの送信実績は最大1回/秒。デバイス内に履歴を蓄積しない。
- 新規計測にキー・トークン・会話本文・録音・機器IDを含めない。PC側もallowlistのみ保存する。

## 関連経路の確認と未確定事項

- XiaoZhi PCM ringはnative acquire/release atomic、満杯時は新規チャンク拒否とdrop計測。
  既存Opus decodeは入力長、出力容量、消費量、偶数の有効PCM長を検証する。
  16kHz入力、helloで指定されたmono出力レートと、mainの出力設定を維持。
- RecognitionTTSは `closeChat()` でXiaoZhiを終了してから生成し、cancel/finallyで解放する既存lease経路を保持。
- offline読み上げはstopCloud/acquireExclusive/finally unlock、撮影は既存の会話終了→撮影→再接続を保持。
  モニター終了、カメラ復帰、Gemini/Ollama混在の実機ヒープ・音響安全性は未検証。
- `archive-volume.js` は既存のbounded previewキューを保持。#36の再起動原因は未確定。
- #40の実測RAM不足は事実だが、消費元の全内訳や反復接続リークは未確定。
  今回の出力生成途中の漏れ・レート変更時保持はコードで修正した範囲に限る。
- #32は過去にPAN/TILT応答失敗と後日の読取り成功が報告されている。
  通信・電源・可動範囲のどれが原因かは未確定。サーボ関連実装と設定は変更せず、動作試験なし。

## ソフトウェア検証

実行結果:

- `npm run test:unit`: 553/553 PASS（TypeScriptコンパイル含む）。
- 全Archive Nodeテスト: 145中144 PASS / 1 FAIL。話者選択の既存失敗を確認。
  初回のSDK path/子プロセス起動権限による失敗は、MODDABLE設定と権限調整後に再実行した。
- production C + pthread/UBSan: PASS。
- PC診断collector Python: 7/7 PASS。
- `npm run clean` → `npm run build:archive`: CoreS3 releaseビルド成功。
  最終JS変更を含む生成物の更新ビルドも成功。
- 変更JS構文検査、`git diff --check`: PASS。
- 実機、音響、サーボ、反復接続のヒープ実測: NOT RUN。

ホストCテストはproduction structsとdrain/write関数をコンパイルし、
mock I2S、2 pthread、UBSanでPCM内容・順序・二重消費なし・音量係数・短書込み・エラー後停止を検証。
ISR・XS GC・実機I2S割込みの完全な代替ではない。

Node追加テストは入力だけで緑にしない、送信実績の失効、socket backpressure、
レート変更、旧Timer、close後のWorker/入力/再生callback、出力生成失敗、
callback二重通知、診断privacyを検証。既存jitter/周回テスト、#47写真回帰も実行。

`archive-speaker-selection.test.mjs` は#47の元のdirect-chatソースでも同じassertionに失敗した。
今回の修正で直った扱いにせず、全Archiveテスト成功とは報告しない。

## 承認後の安全な実機検証とロールバック

現時点で書込み・音響/異音再現・サーボ試験の承認はない。

1. ユーザーが書込みを承認した後、既存の16MiB全flash backupとSHA256、現在のfirmware SHAを確認。
   SD保存内容はflash backupに含まれないので別途保全する。秘密情報をPRへ添付しない。
2. 書込み前に低音量/消音の扱いをユーザーと合意する。今回のコードは音量を変更しない。
3. 書込み後はまず読み取り専用LAN診断でidle、接続、文字起こし開始/終了の数値を比較。
   `input=running`だけで成功にせず、upload有効・lastSentAt更新・ASR受信を順に確認。
4. 別途音響試験が承認された場合のみ、低音量の短い通常発話から開始。
   異常があれば即座に会話OFF/消音し、再現を繰り返さず、診断数値を保存する。
   通常会話・文字起こし・STT+Gemini/Ollama、撮影後復帰、monitor終了、接続反復の順に小分けで実施。
   RAM free/largestの回復、underrun/overrun、無再起動、LED整合、実際の聴感を別々に記録する。
5. サーボと電源操作はこの手順に含めない。必要なら別の明示承認と小振幅手順を用意する。
6. 異常時はこのPRをマージせず、承認済みの復旧手順で事前backupをSHA256照合して書き戻す。
   ロールバック書込みにも承認が必要。既存kmacスクリプトのrestoreが利用できるが、今回は実行しない。
   ソースは専用worktreeを残して#47を別worktreeでビルド可能。元のdirtyツリーのreset/破棄は不要。
