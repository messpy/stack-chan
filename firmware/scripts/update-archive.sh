#!/usr/bin/env bash
# Incremental build/flash with durable status. No AI process is launched.
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
case ${1:-} in
  --help) echo 'Usage: scripts/update-archive.sh [--build-only|--flash-only|--status]'; exit 0;;
  --status) /usr/bin/python3 -m json.tool dist/update-logs/latest.json; exit $?;;
  ''|--build-only|--flash-only) ;;
  *) echo 'Unknown option' >&2; exit 2;;
esac
mode=${1:-}
mkdir -p dist/update-logs
exec 9>dist/update-logs/update.lock
flock -n 9 || { echo '別の更新が実行中です。' >&2; exit 1; }
run_id="$(date +%Y%m%d-%H%M%S)-$$"
log_file="$PWD/dist/update-logs/$run_id.log"
exec 3>&1
exec >> "$log_file" 2>&1
service=${STACKCHAN_HUB_SERVICE:-stackchan-hub.service}
restart_hub=false
phase() {
  /usr/bin/python3 scripts/update-status.py "$PWD/dist/update-logs" "$1" "$run_id" "$log_file"
  printf '[%s] %s\n' "$(date +%H:%M:%S)" "$2" >&3
}
finish() {
  result=$?
  trap - EXIT
  set +e
  if $restart_hub; then
    phase restoring 'USB管理サービスを復帰中'
    systemctl --user start "$service" || result=1
  fi
  if (( result != 0 )); then
    phase failed "失敗（終了コード $result）。ログをCodexで確認してください。"
    tail -n 12 "$log_file" >&3
  elif [[ $mode == --build-only ]]; then
    phase built 'ビルド成功。本体には書き込んでいません。'
  else
    phase succeeded '書き込み成功。本体での会話・画面の確認は別途必要です。'
  fi
  /usr/bin/python3 scripts/update-status.py "$PWD/dist/update-logs" \
    "$([[ $result != 0 ]] && echo failed || { [[ $mode == --build-only ]] && echo built || echo succeeded; })" \
    "$run_id" "$log_file" "$result"
  printf '状態: %s\nログ: %s\n' "$PWD/dist/update-logs/latest.json" "$log_file" >&3
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
phase preparing '環境を準備中'
node_bin=${STACKCHAN_NODE_BIN:-/mnt/data/Development/node22/current/bin}
[[ ! -d $node_bin ]] || export PATH="$node_bin:$PATH"
set +u
source "${STACKCHAN_XS_ENV:-$HOME/.local/share/xs-dev-export.sh}"
source "${STACKCHAN_IDF_ENV:-$HOME/.local/share/esp32/esp-idf/export.sh}"
set -u
[[ -f host/app/manifest_archive_private.json ]] || { echo 'Run npm run init:archive first.' >&2; exit 1; }
if [[ $mode != --flash-only ]]; then
  phase building 'ビルド中（詳細はログに保存）'
  npm run build:archive
fi
[[ $mode != --build-only ]] || exit 0
shopt -s nullglob
ports=(/dev/ttyACM* /dev/ttyUSB*)
(( ${#ports[@]} == 1 )) || { echo 'Connect exactly one USB serial device before flashing.' >&2; exit 1; }
[[ -r ${ports[0]} && -w ${ports[0]} ]] || { echo 'USB serial port is not accessible.' >&2; exit 1; }
if systemctl --user is-active --quiet "$service"; then
  restart_hub=true
  systemctl --user stop "$service"
fi
phase flashing '本体へ書き込み中。USBを抜かないでください。'
export UPLOAD_PORT="${ports[0]}"
npm run deploy:archive
