# Issue #40: RAM不足時の再試行停止

## 確認した原因と修正範囲

Issue #40の保存診断は、接続前 internalFree 76,659B / internalLargest 31,744B。
Opus開始条件112KiB / 24KiBのうち合計空きが38,029B不足している。
接続後の約44KiBという値と接続前の判定は別物である。

PR #49 (`aedcf60b`) を調査した結果、`failed()` はRAM不足の場合も
`retryAt`を更新し続け、2秒周期の監視から`connect()`を無制限に再実行する。
最大60秒のbackoffは回数制限ではない。
これはIssue #40の「回復できなければ安全に停止」の未達原因である。
RAMを消費した処理、リーク、ユーザーが聞いた異音の原因を特定したわけではない。

会話・文字起こしに共通の連続RAM失敗回数を追加した。
初回失敗後に既存backoffと最低10秒の待機で2回だけ再試行する。
各試行は既存のRAMガードを通るまでWorker/Opusを生成しない。
3回目の連続RAM失敗で`failed`状態に停止し、AudioIn/Out/Workerを既存の
世代保護付きcleanupで解放する。マイク表示を消し、OFF→ONの案内を表示する。
`connect()`側の停止フラグも確認するため、モニター・カメラ・Wi-Fi復帰や
自動オフライン復帰がretryAtを変更しても再開しない。

一時的な不足から接続に成功した場合、別種の障害が起きた場合、
またはユーザーが会話・文字起こしモードを操作した場合は連続回数をリセットする。
通信障害の従来の再接続方針、認証更新、保存したON/OFF設定は変更しない。
112KiB / 24KiBの保護閾値も変更しない。

## 診断

既存の認証付き`/chat/status`に`memoryRecovery`を追加。
`/diagnostics/status`とPC側`archive-lan-diagnostics.py`にも
`failures`、`stopped`、`limit`だけをallowlistで追加する。
停止中は`state=failed`、`failureClass=memory-pressure`となる。
新たな会話本文・録音・識別子・認証情報は保存しない。
停止ログは停止への遷移時のみで、周期ごとの大量ログは追加しない。

## 検証

- `npm run test:unit`: TypeScript検査を含む553/553 PASS。
- Archive回帰: 156件中155 PASS / 1 FAIL。
  `archive-speaker-selection.test.mjs:14` expected 1 / actual 0 は
  変更前のPR #49 worktreeでも同じ失敗を再確認。今回の修正済みとはしない。
- 新規動作テスト6件: 会話/STTの持続不足、手動OFF→ON、
  モニター等の再開・オフライン復帰による停止解除防止、
  通信障害との区別、codec失敗時の解放と遅延失敗無視、
  RAM回復後の接続成功、オフライン中の新規接続防止を確認。
- PC診断Python: 8/8 PASS。停止診断の秘密情報除外も確認。
- JS構文・`git diff --check`: PASS。

本変更の実機書込み・RAM不足誘発・音声再生・サーボ操作は未実施。
実機での反復接続とheap回復、音質改善の受入判定は未完了。
CoreS3ビルド結果はPR本文に記録する。

## 安全な受入と戻し方

まず通常の低音量設定を維持し、状態とRAMの読取りのみで確認する。
実機に負荷をかけてRAM不足や異音を作り出さない。
自然発生したRAM不足では3回目に`failed`と停止診断が出ること、
停止後に勝手に接続しないことを確認する。他の処理を終了してから
本体UIで対象の会話または文字起こしをOFF→ONにし、
次回ガードがpassなら再接続することを確認する。
実機試験では対象モードと接続前後のinternalFree/internalLargestを区別する。

コードのロールバックはこの専用ブランチのコミットをrevertする。
元worktreeの未コミット差分をresetしない。ファームウェアの復元が必要なら
既存の検証済み16MiBバックアップを使う。今回の変更はまだ書き込んでいない。
Issue #40はRAM消費元と実機受入が未確定のためOpenを維持する。
関連: #49（依存PR）、#36、#37、#50。
