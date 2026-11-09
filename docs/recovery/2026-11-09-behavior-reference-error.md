# Issue #60: behavior ReferenceError（PR #58撮影調査とは別）

## 証拠

実機ソースSHA `0a81a69d91c4f0b19a43d1ae87eedf76a9c58709`。
`/home/kmac/work/stackchan-runs/run-20261109-173616-hb94rynn/boot-stages.log`:

- 2026-11-09 17:38:35 +0900 context進入、17:38:37 behavior進入後ReferenceError。
- internalFree=165543 / internalLargest=90112 / psramFree=6864956（ユーザー提示値）。
- component=none、site空欄。具体的な未定義参照は保存されていない。
- USB同一性確認、16MiBバックアップ、書込検証は成功。公式Faceを表示する起動成功は未確認。

contextを通過しており、以前のcontext失敗仮説と区別する。RAM不足を示す証拠ではない。

## 調査と修正

mainの5操作を確認。Dock hook、mini-app登録、awaitされたbehavior hook、Archive初期化、shortcut設置を独立checkpointにし、Archiveのmodule importとstart呼出しも分離。readyはshortcut設置後に記録する。

既定動作のsetup/face/hands/colors/IMU、Archiveのdebug/clock/face/offline/history/volume/AI settings/Wi-Fi display/timer/alarm初期化も同じ診断経路へ記録する。深い箇所の失敗を外側のcatchが上書きせず、元の例外を再throwする。設定/NVSを初期化せず、既存の任意機能のcatch方針とFace動作を維持する。

固定SDKの `xs/sources/xsError.c` で、stack frameは `at 関数名 (moduleID:line)`、拡張子なしmoduleIDがあり得ることを確認。従来のjs/ts必須正規表現の抽出漏れを修正。例外ヘッダーや関数名は保存せず、frameのbasename/行番号だけを許可する。stack自体がない場合もcomponentを残す。USB collectorも同じ形式を受理する。

**実機ReferenceErrorの具体的な未定義シンボルは未確定。診断欠落の修正であり、起動障害の解消を保証する変更ではない。** PR #90の既存起動診断と同じ範囲のためPR #90へ集約し、新規PRは作らない。

## 検証

ログ: `/home/kmac/work/stackchan-behavior-evidence-20261109/`。

- 実際のmainを実行する故障注入: 9/9 PASS（5処理、import、深い失敗、非同期、ready順序）。
- context/画面/async initializer: 17/17 PASS。
- CLI: 43/43 PASS。
- archive-debug smoke PASS（XS拡張子なし、階層module、stackなし、秘密情報ヘッダー除外）。
- TypeScript test project noEmit PASS。
- Archive UI: ファイル集計29件、28 PASS / 1 FAIL / 0 SKIP。失敗はarchive-screen-copyの `spawnSync cc EPERM`。隔離環境の子プロセス制約で、全テストPASSとはしない。
- 新規テストハーネスの初回はmockのrunLaunchBehaviors export不足で失敗。mock修正後上記9件PASS。
- CoreS3ビルド・成果物照合: 後続の結果を追記する。

## 次の実機検証

既存 `~/stackchan.sh` のみ使用する。USB同一性・16MiBバックアップ・SHA256・成果物照合を省略しない。新しいcheckpointで起動失敗component/siteを取得する。書込検証、ready観測、公式Face表示は別判定。実機でのFace/タッチ/オフライン/カメラ・音声復帰は未確認。
