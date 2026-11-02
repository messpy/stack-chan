#!/usr/bin/env bash
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." || exit 1
printf 'StackChan 更新\nUSBで本体を1台接続し、電源を入れてください。\n'
printf 'ビルド・書き込みを開始します（中止はCtrl+C）。\n'
scripts/update-archive.sh "$@"
result=$?
printf '\nCodexに「更新が終わった。ログ見て」と送ると、保存済みの結果を確認できます。\n'
read -r -p 'Enterでウィンドウを閉じます: '
exit "$result"
