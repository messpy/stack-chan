#!/usr/bin/env bash
# Incremental build and flash for the configured CoreS3 archive application.
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ ${1:-} == --help ]]; then
  echo 'Usage: scripts/update-archive.sh [--build-only]'
  echo 'Optional: STACKCHAN_NODE_BIN, STACKCHAN_XS_ENV, STACKCHAN_IDF_ENV, STACKCHAN_HUB_SERVICE'
  exit 0
fi
mode=${1:-}
[[ -z $mode || $mode == --build-only ]] || { echo 'Unknown option' >&2; exit 2; }
mkdir -p dist/update-logs
log_file="$PWD/dist/update-logs/$(date +%Y%m%d-%H%M%S)-$$.log"
exec > >(tee -a "$log_file") 2>&1
printf 'Update log: %s\n' "$log_file"
exec 9>dist/update-logs/update.lock
flock -n 9 || { echo 'Another firmware update is running.' >&2; exit 1; }
node_bin=${STACKCHAN_NODE_BIN:-/mnt/data/Development/node22/current/bin}
[[ ! -d $node_bin ]] || export PATH="$node_bin:$PATH"
# SDK environment scripts may access unset variables.
set +u
source "${STACKCHAN_XS_ENV:-$HOME/.local/share/xs-dev-export.sh}"
source "${STACKCHAN_IDF_ENV:-$HOME/.local/share/esp32/esp-idf/export.sh}"
set -u
[[ -f host/app/manifest_archive_private.json ]] || { echo 'Run npm run init:archive first.' >&2; exit 1; }
service=${STACKCHAN_HUB_SERVICE:-stackchan-hub.service}
restart_hub=false
finish() {
  result=$?
  trap - EXIT
  if $restart_hub; then
    systemctl --user start "$service" || { echo 'Failed to restart USB hub.' >&2; result=1; }
  fi
  printf 'Update finished: exit=%s; log=%s\n' "$result" "$log_file"
  exit "$result"
}
trap finish EXIT
# Keep incremental outputs; do not clean or build a second custom output tree.
npm run build:archive
[[ $mode != --build-only ]] || exit 0
shopt -s nullglob
ports=(/dev/ttyACM* /dev/ttyUSB*)
(( ${#ports[@]} == 1 )) || { echo 'Connect exactly one USB serial device before flashing.' >&2; exit 1; }
[[ -r ${ports[0]} && -w ${ports[0]} ]] || { echo 'USB serial port is not accessible.' >&2; exit 1; }
if systemctl --user is-active --quiet "$service"; then
  restart_hub=true
  systemctl --user stop "$service"
fi
npm run deploy:archive
