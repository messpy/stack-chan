# KoeAct-JP 操作命令・STTフォールバック（段階実装）

追跡: [Issue #17](https://github.com/messpy/stack-chan/issues/17) / モデル: [ayousanz/KoeAct-JP](https://huggingface.co/ayousanz/KoeAct-JP)（Apache-2.0、v0.1.1、schema v1）

## 今回の実装範囲（Phase 1）

- \`archive-voice-command-policy.js\` はAction JSONを厳格に検証し、確信度 \`pAct >= 0.97\` を要求する。最大2コール、余分なキー・範囲外の値・未知の操作は一括拒否し、**部分実行しない**。
- 取り扱うKoeAct v1 Actionは \`set_volume\`、\`adjust_volume\`、\`look\`（上下左右/中央）、\`set_expression\`（happy/sad/neutral/angry/sleepy）、\`set_led\`。未対応の \`turn/nod/shake/bow/brightness\` は動作しない。角度指定は現行の安全な固定サーボ目標へ丸めるため、角度の厳密追従は未対応。
- \`archive-voice-control.js\` は上記ActionをStackChanの既存APIへ橋渡しする。
- **現在実際に動く音声入力は既存のGoogle/XiaoZhi STT経路**。最終テキストが明確な場合にだけローカルコマンドとして処理し、通常の会話は従来どおり。
- 文字起こしが利用できない完全オフライン状態では、コマンドの音声起動はまだ使えない。
- 音量上下は10%ずつ、数値指定は0〜100%。
- 「サイトのQRを出して」→既存の認証付き「スマホで操作」QR画面（LAN接続が必要）。
- 「AIモードをオフにして」→\`setChatMode(false)\` により会話機能を停止。音声認識単独モードは維持。
- 「シャットダウンして」→10秒以内に「シャットダウン実行」を要求するが、**現行のCoreS3実機電源OFF APIが未検証のため、確認後も「未実装」と表示して電源は切らない**。モデル出力のみのシャットダウンは禁止。

## KoeActランタイム未接続の理由

公開CoreS3版は推論後に \`piece IDs + p_act\` をUSB経由でPCへ出し、閾値処理とAction JSON組立はPC側が担う。これをModdable StackChan単体へ移す必要がある。

上流のモデルは16kHz mono、0.4秒フレーム、.espdl約4.81MB + decoder約1.13MBのFlash領域、追加PSRAM約1.11MB（単独実測）。カメラ、SQLite、常時会話のある本ファームウェアのFlashパーティション、内部RAM、音声入力排他、24/365動作との共存を実機で測る必要がある。

そのため**本PRをKoeAct-JP本体の推論統合済みと扱わないこと**。将来のCoreS3ランタイムが \`handleKoeActResult({pAct,actions})\` に正しく復元・認証した結果を渡す設計であり、今は呼出元がない。外部から任意にAction実行を受け付けるHTTP APIも追加していない。

## テスト

\`\`\`bash
cd firmware
node --test scripts/lib/archive-voice-command-policy.test.mjs scripts/lib/archive-voice-control.test.mjs
\`\`\`

確認済み（Node 22、6件成功）: 日本語の限定構文、否定/質問の拒否、音量範囲、全角数字、0.97の閾値、スキーマ拒否、2ツール、QR/AI OFFのコールバック、シャットダウンのキャンセル/期限切れ。

未確認: \`npm run test:archive-ui\`、Moddable実機ビルド、USB/リアルSTT、手持ちCoreS3上のPSRAM、シャットダウン実際の電源制御。

## ロールバック

\`feat/koeact-voice-command-bridge-20261103\` の採用を見送り、\`stackchan-super\` の旧バイナリを使用。DBスキーマや暗号化設定への移行はない。追加のモデル重み、Flashパーティション変更、PMIC変更もない。

## 注意

公開モデルのベンチマーク（合成音声 EM 93.2%、非依頼発話の誤発火1.57/時）は、**今回のファームウェア上での認識精度を意味しない**。機器操作には信頼度ゲート、確認フロー、物理制約と実測が必要。
