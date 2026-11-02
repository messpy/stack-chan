# 音声認識と会話AIを別々に選ぶ

設定の「音声認識」は「自動（従来どおり）」または「XiaoZhiで文字起こし」。会話AIの選択とは独立して保存する。本体のAI設定にも「認識」切替ボタンを追加。

- 自動: GeminiはGemini Live、OllamaはGemini Liveを音声入出力に使う従来動作。
- XiaoZhi認識＋Gemini: 音声をXiaoZhiへ送信し、確定した文字をGeminiのテキストAPIへ送信。Liveモデルとは別に「Gemini文字応答モデル」を指定できる。
- XiaoZhi認識＋Ollama: 音声をXiaoZhiへ送信し、確定文字を選択したOllama Cloudモデルへ送信。この組み合わせでは音声用Geminiキーは不要。
- 会話AI自体がXiaoZhiの場合は通常のXiaoZhi会話を維持。

XiaoZhi公式WebSocketの `stt` イベントを受信したら `abort` を送る。認識専用時は本体側で返答音声・文章・MCP操作を受け入れず、認識文だけを通常の会話保存処理へ渡す。公式クラウドの「文字起こし専用API」ではないため、サーバー側で推論が全く実行されない保証や、無料枠・料金の保証はしない。

本体では認識結果を受けた後、XiaoZhiの接続・マイクを完全に閉じてから別AIを呼び出す。応答は本体内蔵の合成音声で読むため、従来の声とは異なる。音声出力が終わったらXiaoZhiへ再接続する。1ターンごとの再接続時間が加わる。PCは不要だがインターネット接続は必要。

確定した認識文・AI返答は従来のSD会話DBとJSONに保存する。人物プロフィール・タイマー・アラーム等の道具は返答AIから実行する。途中でOFFまたはモデル変更をしたら、古い推論結果・読み上げを破棄する。会話OFFの保存状態を勝手にONへ変更しない。

テスト: 実際のXiaoZhiワーカークラスで、STTの受け渡し／abort／音声・文章・MCPの抑止／通常モードの維持を確認。会話層で、GeminiキーなしのOllama＋XiaoZhi認識、道具実行、ローカルTTS、推論途中OFFを確認。GeminiテキストAPIはツール呼び出し結果の引き渡しと選択モデルをモックで確認。

実機確認（2026-11-02、更新 `20261102-000026-36530`）: 会話AIをGemini、音声認識をXiaoZhiに設定して、`connected:true,provider:gemini,recognitionProvider:xiaozhi,microphoneTransmission:false` を確認。音声を送らない接続確認のみで、実音声の認識→選択AI→読み上げの往復は未検証。元の会話AI（XiaoZhi）と会話OFFを復元し、認識設定はXiaoZhiを保存。

参照: https://github.com/78/xiaozhi-esp32/blob/main/docs/websocket.md （stt、tts、abort）。Geminiテキストモデルの候補: https://ai.google.dev/gemini-api/docs/models 。
