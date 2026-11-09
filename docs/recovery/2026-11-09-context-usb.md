# CoreS3 context起動失敗・USB障害の調査

Release impact: patch。USB障害とアプリ起動失敗を別の事象として扱う。実機復旧は未確認。

## 書き込まれたソースと確定した事実

13:04〜13:07の成功実行 `run-20261109-130453-jkox2wry` のsource SHAは
`15371f3460efe433d3c95c1480f827f59209225c`。親はbase `c875399e` とPR #90当時のHEAD
`598f959d`。書込みログのhash verificationとreceiptを照合した。app image SHA256:
`16d4cbd039896e7611c68d5821bdb21e68498e6c7ac4bc81c2fb875513513744`。

ROMのSPI_FAST_FLASH_BOOTは通常フラッシュ起動モードの証拠で、Face表示成功の証拠ではない。
ユーザー画面の「ロボットの初期化 / Error」はcontextフェーズを示す。
`loadPreferenceConfig` とcompose/runtime各constructorのどこで失敗したかは未確定。
13:04直前バックアップの許可した非秘密設定だけを読み、tts.volume=0.1を確認した。
不正な保存済みdriver/UI/TTS種別はこのバックアップからは検出しなかったが、現在のNVSは未取得。
設定値の復元・NVS初期化・消去はしていない。

baseと実機sourceのcompose/preferencesに差分はなく、camera wrapper constructorは
native cameraをまだ開かない。マイク/スピーカーもconstructorではI2Sを開始しない。
これだけでRAM不足やUSBとの関係を否定はできない。driver/UART、公式Face/UI、TTS resource、
TouchPanel/IMU/I2C、LED/PY32、runtimeの順に例外候補がある。

## 確認できた修正対象

- USB受信配列が内部BSSを20,005バイト常時使用。
  既存の成功ビルドmapに `.bss.line ... 0x4e25 ... archive-usb.c.o` がある。
  PR #58 (`273da02a`) のPSRAM遅延確保だけをbackportした。read時に一度確保し、失敗は例外。
  これは内部RAM消費の改善であり、今回のcontextエラーがメモリ不足だった証明ではない。
- 既存phase/USB/RTC診断を拡張し、selection/driver/UI/TTS/sensor/LED/runtime内の段階を区別。
  例外を同じidentityで再throwし、深い原因を外側のruntime例外で上書きしない。
  原因分類とメモリはcheckpoint時点で固定。cleanup前の失敗をRTCにも保存する。
  旧RTC形式とはmagicを区別し、更新途中の記録は無効化。秘密や例外本文は保存しない。
- USBなしでも起動エラー画面にcomponent、原因分類候補、RAM/最大連続/PSRAMを表示する。
  公式Faceの通常描画・Wi-Fi設定・ネットなしでのローカル動作は変更しない。
  正常起動を装うためのconstructor例外握りつぶしは追加しない。
- `Runner.cmd` がsudoまで `start_new_session=True` で実行し、端末セッションを切断していた。
  tty単位sudo認証では、呼出元の `sudo -v` を引き継げない構造だった。
  sudoだけは同じsession内の独立process groupに変更し、期限時の子プロセス停止を維持。
  sudo設定・global timestamp・認証要件は変更しない。

sudo 15:35の「パスワードが必要」と、隔離実行環境のno-new-privileges失敗は区別する。
後者の権限制限を回避しない。修正後のkmacでのsudo成功は実機実行で確認が必要。
参照: https://github.com/sudo-project/sudo/blob/main/INSTALL.md

## USBの切り分け

13:26〜13:27、16:02〜16:03、16:08にもdescriptor read/64のEPROTO(-71)、
setup address無応答、power cycle後のenumerate失敗が記録された。一部にETIMEDOUT(-110)が挟まる。
ホストのlsusbにもEspressif/ttyACMがなかった。これはesptoolより前の段階での失敗。
その時点でVID/PIDを読めない機器を、ログだけで本体と断定はしない。
USBコントローラはactive、power/control=on、対象portはhotplug/disable=0、過電流記録は0。
ケーブル/本体USB/電源経路/ホストのどれかは未確定。ケーブル交換/抜き差し/リセットの再提案はしない。

CoreS3のSDK providerとEspressif BSPを比較すると、USBはGPIO19/20、I2Cは11/12、
AW9523によるUSB enableを持つ。今回のcontext診断にGPIO/USB mux変更はない。
PMIC/expander/I2Cが原因という仮説を、RAM不足や単なるOSポート名変更と混同しない。
公式参照: https://github.com/espressif/esp-bsp/blob/master/bsp/m5stack_core_s3/include/bsp/m5stack_core_s3.h

## 次の操作

USB未認識ではバックアップ・書き込みを開始しない。ROMでも未認識ならOS側の列挙/電源経路の
調査を継続する。ROMで認識する場合は既存の単一CLIの同一性確認・16MiBバックアップ・SHA256・
成果物検査を通して初めて書き込む。起動後ログと画面の新しいcomponent診断を照合する。

```bash
# kmacの通常端末・同じtmux内で認証。sudoは別セッションへ移さない
sudo -v
# 1-1が本体を接続した外部ポートだと確認済みの場合のみ、対象portの復旧と確認
bash ~/stackchan.sh --recover-usb --usb-path 1-1 --check --yes
```

ポートの再有効化をfinallyで保証し、認識済み別機器・内部portは拒否する。
全コントローラのreset/unbind、他のUSB機器の操作、NVS初期化、フラッシュ全消去はしない。
復旧成功とファームウェア書き込み成功とFace表示成功は別々に記録する。

## 検証結果（今回）

- 新規コンポーネント故障注入/正常構築/画面の機密除去: 16 PASS / 0 FAIL。
- CLI（sudoセッション保持/プロセスグループ分離を含む）: 42 PASS / 0 FAIL。
- TypeScript test project noEmit: PASS。archive-debug既存/拡張smoke: PASS。
- 全Unit: この環境の集計105中101 PASS / 4 FAIL / 0 SKIP。
  失敗ファイルはfirmware-command/module-test-completion/module-test-runner/xsdb-session。
  この環境ではローカルTCP待受/一部子プロセス起動がEPERMで拒否される。
  更新後の全件PASSを主張しない。
- Archive: 集計43中42 PASS / 1 FAIL / 0 SKIP。失敗は既存screen-copyのspawnSync cc EPERM。
  ファイル単位smokeを含む集計で、新規16ケースとの単純加算はしない。
- CoreS3 Archive公式build: PASS。最初の試行はcomponent registryへ接続できず設定段階で失敗。
  旧成功buildとidf_component.ymlの一致を照合し、同一lock/managed_componentsソースをコピー・
  SHA256照合して再実行。旧成功のfirmware imageやSDK設定を上書きしていない。
  成功ログ: /home/kmac/work/stackchan-runs/run-20261109-170630-5rypfp8g/build.log
- 新build mapの .bss.line は4バイト。旧20,005バイトから20,001バイトの内部BSS削減を確認。
  実機の起動時heap/最大連続/PSRAM/stack不足の有無は未測定。
- 今回はUSB未認識のためバックアップ/書き込みを開始していない。新build未書込み。
  根本原因・公式Face表示・Wi-Fi復帰・撮影成功の実機受入は未完了。

生成物は作業先firmware/dist/bin/esp32/m5stackchan_cores3/release/stack-chan-host/以下。
ソース/SDK/設定/生成物の照合結果は同作業先firmware/dist/stackchan-build-receipt.json。
GitHubへのpushはコード共有であり、merge/本体書き込み/起動成功とは異なる。
