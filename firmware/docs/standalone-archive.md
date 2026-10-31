# Standalone StackChan archive and conversation extension

Release impact: minor. Target: M5Stack CoreS3 / completed M5Stack StackChan.

From `firmware/`, run `npm run init:archive` to create the ignored, mode-0600 private manifest with a fresh random local-access token, then `npm run build:archive` and `npm run deploy:archive`. Use the existing managed SDK/ESP-IDF environment. The example manifest contains no deployed credentials. Do not commit the private manifest or copy its token into source.

The firmware supports USB and authenticated LAN/AP control, SD photos/video/audio, streamed alarm audio and timers, encrypted Wi-Fi/API settings, and SQLite profiles/history. Speech and image requests use the selected Gemini or XiaoZhi provider; failures do not fall back to another provider. XiaoZhi image uploads are restricted to HTTPS api.xiaozhi.me/api.tenclass.net. Gemini API keys are entered through the local settings UI and are never echoed.

Before conversation, choose a registered person, register through the browser, or choose guest. No microphone conversation session starts before selection. Only a short profile and the latest three related records enter the initial context. Person and assistant messages are associated with that selected person; profiles remain separate from transcripts.

Button definitions use `text`, `background`, `textColor`, `method`, and `args`. Methods are explicitly registered callbacks; button text and percent-prefixed AI text are not evaluated as code. Timer/alarm actions use the existing MCP methods such as `timer_create` and `alarm_create`.

The device settings menu contains Wi-Fi/API setup, LAN QR, explicit AP operation, signal strength, and AI selection. LAN operation waits for a LAN address and never auto-enters setup AP mode. Lost Wi-Fi retries with bounded backoff. Browser-uploaded JPEG/PNG/WebP images are converted to JPEG at up to 800 pixels, stored on SD, and linked to the question and result in history.

Checks: `npm run test:archive-ui`, `npm run test:archive-http`. Node 22.13+ is required for the SQLite/TypeScript test helpers. Hardware testing additionally covers SD readback, provider authentication, camera, servo movement, and Wi-Fi display. Never include SD media, conversation databases, credentials, or diagnostic logs in Git.

Gemini image recognition defaults to `gemini-3.1-flash-lite` with low thinking and a bounded response timeout. This remains separate from the Gemini Live audio model; choosing Gemini/XiaoZhi selects the provider for both capabilities. No cross-provider fallback occurs.

### 本体で声によるユーザー登録
「あなたは誰？」で登録済みの人、または「新規登録（声）」を選択します。新規登録では選択中のAIに接続して名前を聞き取り、本体の「この名前で登録」で確認してからプロフィールを保存します。「声で聞き直す」「キャンセル」も本体で操作できます。登録中の音声文字起こしは会話履歴に保存しません。登録済みの人を選ぶと、その人のプロフィールと直近3件の関連履歴を読み、会話を始めます。

### Ollama Cloud
本体のAI選択、LANブラウザ、USBブラウザで「Ollama Cloud」を選択できます。選択中サービスのAPIキー欄へOllamaキーを入力して保存してください。Geminiキーとは別にSDへ暗号化保存します。モデルの既定値は `gemma4:31b`。モデル名欄で変更できます。「保存済みOllamaキー・モデルを確認」で小さな接続確認リクエストを送信します。

会話の返答・道具選択・画像認識は `https://ollama.com/api/chat` へ送信します。音声認識と読み上げは既存Gemini Liveを使用するので、音声会話にはGeminiキーも必要です。PCは不要ですがインターネット接続は必要です。Geminiには音声入出力のみを指示し、Ollamaの回答を読み上げます。Ollamaエラー時に別のAIで回答を代行しません。

人物プロフィール・直近の関連履歴は従来と同じ範囲でOllamaへ渡し、タイマー等の道具は許可済みの関数だけを本体で実行します。画像対応がないモデルを選ぶと画像認識が失敗しますが、画像はSDに残ります。

### 本体だけで使うオフライン機能
本体メニューの「オフライン（本体だけ）」を開きます。顔は表示したまま、下端に2つの選択肢と「次へ」「×」が出ます。「次へ」で選択肢を切り替え、「×」でボタンだけを閉じます。タイマーの分数も顔の下で調整できます。クラウド会話をOFFにし、「こんにちは」「今何時？」「できること」のボタンへ本体内の日本語合成音声で返答します。「タイマー」は1～120分を選び、開始すると声で確認します。「アラーム」から既存の日時・毎日設定を使えます。日本語の音声聞き取りや自由なAI会話には対応していません。

ネット・PC・APIキーは不要です。時計が未設定でもタイマーは起動中の経過時間で動き、途中の時刻同期や手動変更には影響されません。時計が未設定のまま再起動したタイマーは解除されます。日時指定アラームには正しい時計が必要です。「時計設定」から日本時間の年月日・時分を手動で設定できます。

メーカー公式と同じPCF8563系RTCを使い、Wi-Fi・USB・手動設定で得た時刻をUTCで保存します。RTCの電源と時刻が有効なら次回起動時に復元できます。保存は読み戻して検証し、失敗や電圧低下は診断に残します。時計を保持できても、本体の電源が切れている間はアラームを鳴らせません。

### 長文の循環表示
通常の `robot.showBalloon(text)` は、メーカー公式のSpeech Bubbleと同じ1行の循環横スクロールです。短文は静止し、長文は最初に1秒待ってから毎秒30pxで流れ、末尾のあと先頭へ戻ります。`{marquee:false}` で従来の折返し、`{speed:40}` で速度を指定できます。明示的な複数行 `showBalloonLines` は維持します。

AIの返答と画像認識の全文にも適用します。オフラインの下端ボタンがあるときは吹き出しを上へずらします。表示窓を使うため長い文章もPiuの16bit座標範囲に依存せず、画面から外れたらアニメーションを止めます。参照したメーカー実装は `m5stack/StackChan` の `firmware/main/stackchan/avatar/skins/default/speech_bubble.cpp` の `LV_LABEL_LONG_MODE_SCROLL_CIRCULAR` です。
