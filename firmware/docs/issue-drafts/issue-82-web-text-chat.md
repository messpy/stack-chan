# Issue #82: ブラウザからテキストをAI会話へ送信

> **Draft / planning only.** このPRでは実際の送信エンドポイントやUIをまだ追加しません。

## 既存コードの利用候補
- `firmware/host/app/archive-web-page.js`：認証済みLAN操作画面と共通RPCヘルパー
- `firmware/host/app/archive-web.js`：認証、Origin、リクエストサイズ制限付き`POST /rpc`
- `firmware/host/app/lan-archive.js`：実行RPCの分岐（`/chat/start`、`/chat/stop` 等）
- `firmware/host/app/archive-direct-chat.js`：XiaoZhi/Gemini/Ollamaのプロバイダー、会話指示、音声とテキストの経路
- `firmware/host/app/archive-memory.js`：履歴、人物情報

## 安全な段階実装
1. 既存`sendText()`と`geminiTextChat()`/`ollamaChat()`の契約を確認。ブラウザ入力を生`system`指示として使わず、通常`user`メッセージとして送信する。
2. 認証付き`/chat/text`相当のRPCを実装。空、長すぎるUTF-8、重複requestId、不正な型、同時音声会話中、未接続/未設定時に失敗する。
3. 応答を`queued/sent/answered/failed`などに分類し、AIの確定回答・ブラウザ表示・本体吹き出し・TTSを別々に記録。
4. 既存人物・履歴・日時の文脈に合わせる（#2、#6、#8）。質問と回答を対応付け、過去の未確定履歴を誤結合しない。
5. 外部Webからのツール実行を無条件に許さない。サーボ/カメラ/削除等を明示許可するまで無効化する。XSSを避け、回答はtextContentで表示。

## 受入チェック
- [ ] 認証済みブラウザから文章を送信し、選択中のAIが処理した回答を返す
- [ ] 音声会話/撮影/AI OFFに干渉せず、公式Faceと履歴を保持
- [ ] APIキー・個人プロフィールをWeb/ログへ漏らさない
- [ ] オフライン、未設定、応答遅延、キャンセル、重複、HTML混入をテスト
- [ ] Nodeテスト、CoreS3ビルド、ブラウザ→AI→本体画面E2E

関連: #2 #6 #8 #34 #40。認証/ツール権限/クラウド送信同意は既存設定を維持。

**実装未着手／本体書き込みなし／Draft維持。**
