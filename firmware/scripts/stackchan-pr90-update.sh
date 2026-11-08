#!/usr/bin/env bash
# Run interactively inside tmux. No camera requests are sent.
set -Eeuo pipefail
umask 077
if [[ ${1:-} == --help ]]; then
 echo 'Run inside tmux after sourcing SDK/IDF. Required: EXPECTED_SHA PORT PRIVATE_MANIFEST SD_BACKUP_DIR. See docs/release-notes/pr90-camera-audio-handoff.md. This script asks before reset/backup and again before flash; it sends no camera requests.'
 exit 0
fi
[[ $# == 0 ]] || exit 64
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
: "${EXPECTED_SHA:?Set EXPECTED_SHA to the reviewed PR90 commit}"
: "${PORT:?Set PORT to the verified /dev/serial/by-id path}"
: "${PRIVATE_MANIFEST:?Set PRIVATE_MANIFEST to the existing credential-bearing archive manifest}"
: "${SD_BACKUP_DIR:?Set SD_BACKUP_DIR to a verified backup with SHA256SUMS}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ -c "$PORT" && -f "$SD_BACKUP_DIR/SHA256SUMS" ]]
[[ -n "${TMUX:-}" ]] || { echo '[FATAL] Run inside tmux to retain work after SSH loss'; exit 1; }
RESULTS=$(mktemp -d "${RESULTS_PARENT:-$HOME}/stackchan-pr90-update-$(date +%Y%m%d-%H%M%S)-XXXXXXXX")
exec > >(tee -a "$RESULTS/console.log") 2>&1
STEP=preflight
RESTORE_SERVICE=0
finish(){
 local rc=$?
 if ((RESTORE_SERVICE)); then systemctl --user start stackchan-hub.service || echo '[ERROR] Could not restore previously active hub'; fi
 echo "[INFO] END=$(date -Is) STEP=$STEP EXIT=$rc RESULTS=$RESULTS"
 if ((rc)); then
  for log in unit archive build backup flash; do
   [[ ! -f "$RESULTS/$log.log" ]] || { echo "[ERROR] LOG=$log.log"; tail -n 40 "$RESULTS/$log.log"; }
  done
 fi
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
cd "$ROOT"
[[ $(git rev-parse HEAD) == "$EXPECTED_SHA" ]]
[[ -z $(git status --porcelain --untracked-files=no) ]]
echo "[CHECK] SHA=$EXPECTED_SHA HOST=$(hostname) START=$(date -Is)"
# Fetch never updates a local branch or merges. Refuse a moved PR head.
git fetch https://github.com/messpy/stack-chan.git fix/camera-audio-handoff-20261108
[[ $(git rev-parse FETCH_HEAD) == "$EXPECTED_SHA" ]]
(cd "$SD_BACKUP_DIR" && sha256sum --strict -c SHA256SUMS) > "$RESULTS/sd-backup-check.log"
PYTHON=${PYTHON:-/home/kmac/.espressif/python_env/idf6.1_py3.12_env/bin/python}
identity(){
 "$PYTHON" - "$PORT" <<'PY'
import json,sys,os
from serial.tools import list_ports
p=next((p for p in list_ports.comports() if os.path.realpath(p.device)==os.path.realpath(sys.argv[1])),None)
if p is None or p.vid is None or not p.serial_number or not p.location: raise SystemExit('Cannot establish serial/VID/PID/physical-port identity')
print(json.dumps(dict(vid=p.vid,pid=p.pid,serial=p.serial_number,location=p.location),sort_keys=True))
PY
}
identity > "$RESULTS/usb-identity.json"
STEP=tests
cd firmware
npm run test:unit > "$RESULTS/unit.log" 2>&1
MODDABLE=${MODDABLE:?Source the reviewed SDK environment first} node --experimental-vm-modules --test --test-concurrency=1 scripts/lib/archive-*.test.mjs > "$RESULTS/archive.log" 2>&1
STEP=build
"$PYTHON" - "$PRIVATE_MANIFEST" "$RESULTS" <<'CONFIG'
import json,sys,shutil,os
from pathlib import Path
src=Path(sys.argv[1]).resolve();dst=Path('host/app/manifest_archive_private.json').resolve();out=Path(sys.argv[2])
if src==dst: raise SystemExit('Use the preserved original private manifest, not the generated CI-only manifest')
data=json.loads(src.read_text());example=json.loads(Path('host/app/manifest_archive.example.json').read_text())
if dst.exists(): shutil.copy2(dst,out/'private-manifest.before.json')
for name in ['archive-camera-handoff','archive-camera-release','archive-chat-pause-gate']:
 data.setdefault('modules',{})[name]=example['modules'][name]
data.setdefault('platforms',{})['esp32/m5stackchan_cores3']=example['platforms']['esp32/m5stackchan_cores3']
dst.write_text(json.dumps(data,indent=2)+'\n');os.chmod(dst,0o600)
CONFIG
[[ -f host/app/manifest_archive_private.json ]] || { echo '[FATAL] Provide the existing private configuration locally; do not print credentials'; exit 1; }
npm run build:archive:m5stackchan_cores3 > "$RESULTS/build.log" 2>&1
BIN=$ROOT/firmware/dist/bin/esp32/m5stackchan_cores3/release/stack-chan-host
"$PYTHON" - "$ROOT" <<'LAYOUT'
import json,sys
from pathlib import Path
r=Path(sys.argv[1]);p=r/'firmware/dist/tmp/esp32/m5stackchan_cores3/release/stack-chan-host/xsProj-esp32s3/build/flasher_args.json';d=json.loads(p.read_text())
assert d['extra_esptool_args']['chip']=='esp32s3'
assert d['flash_settings']==dict(flash_mode='dio',flash_size='16MB',flash_freq='80m')
assert {int(k,0):Path(v).name for k,v in d['flash_files'].items()}=={0:'bootloader.bin',0x8000:'partition-table.bin',0x10000:'xs_esp32.bin'}
LAYOUT
for file in xs_esp32.bin bootloader.bin partition-table.bin; do [[ -s "$BIN/$file" ]]; done
(cd "$BIN" && sha256sum xs_esp32.bin bootloader.bin partition-table.bin) > "$RESULTS/artifacts.sha256"
identity > "$RESULTS/usb-before-backup.json"
cmp "$RESULTS/usb-identity.json" "$RESULTS/usb-before-backup.json"
echo '[WARN] Flash backup resets the device. Confirm the connected unit and SD backup.'
cat "$RESULTS/usb-identity.json"
read -r -p 'Reset this device and read its full 16MiB flash backup? [yes/no] ' ANSWER
[[ "$ANSWER" == yes ]] || exit 2
STEP=flash-backup
if systemctl --user is-active --quiet stackchan-hub.service; then
 RESTORE_SERVICE=1
 systemctl --user stop stackchan-hub.service
fi
if fuser "$PORT"; then echo '[FATAL] Serial port remains occupied'; exit 1; fi
"$PYTHON" -m esptool --chip esp32s3 --port "$PORT" --after no-reset flash-id > "$RESULTS/flash-id.log" 2>&1
grep -Eq 'Detected flash size: 16(MB| MiB)' "$RESULTS/flash-id.log" || { echo '[FATAL] 16MiB flash not verified'; exit 1; }
"$PYTHON" -m esptool --chip esp32s3 --port "$PORT" --after no-reset read-flash 0 0x1000000 "$RESULTS/flash-16MiB.bin" > "$RESULTS/backup.log" 2>&1
[[ $(stat -c %s "$RESULTS/flash-16MiB.bin") == 16777216 ]]
(cd "$RESULTS" && sha256sum flash-16MiB.bin > flash-16MiB.sha256 && sha256sum -c flash-16MiB.sha256)
echo '[INFO] Backup is private: it may contain credentials. Never upload it.'
echo '[INFO] Rollback requires separate approval: esptool --chip esp32s3 --port PORT write-flash 0 flash-16MiB.bin'
echo '[WARN] If cancelled now, the device may remain in bootloader mode; restore normal power manually.'
read -r -p 'Write this reviewed firmware to this device now? [yes/no] ' ANSWER
[[ "$ANSWER" == yes ]] || exit 2
identity > "$RESULTS/usb-before-flash.json"
cmp "$RESULTS/usb-identity.json" "$RESULTS/usb-before-flash.json"
(cd "$BIN" && sha256sum --strict -c "$RESULTS/artifacts.sha256")
STEP=flash
"$PYTHON" -m esptool --chip esp32s3 --port "$PORT" --after hard-reset write-flash --flash-mode dio --flash-size 16MB --flash-freq 80m 0x0 "$BIN/bootloader.bin" 0x8000 "$BIN/partition-table.bin" 0x10000 "$BIN/xs_esp32.bin" > "$RESULTS/flash.log" 2>&1
STEP=boot-log
# Passive, bounded collection; keep only stage/RAM/state markers, never transcripts.
"$PYTHON" - "$PORT" "$RESULTS" <<'PY'
import sys,time,json,os
from serial import Serial,SerialException
from serial.tools import list_ports
from pathlib import Path
port,out=sys.argv[1],Path(sys.argv[2]);expected=json.loads((out/'usb-identity.json').read_text());end=time.monotonic()+90
with (out/'boot-stages.log').open('x') as log:
 while time.monotonic()<end:
  match=[p for p in list_ports.comports() if dict(vid=p.vid,pid=p.pid,serial=p.serial_number,location=p.location)==expected]
  if len(match)!=1:time.sleep(1);continue
  try:
   with Serial(match[0].device,115200,timeout=1) as serial:
    while time.monotonic()<end:
     line=serial.readline(2048).decode('utf8','replace').strip()
     if line.startswith(('[archive-camera]','[camera]','[runtime-camera]','[direct-chat] state=')):
      log.write(time.strftime('%Y-%m-%dT%H:%M:%S%z')+' '+line[:512]+'\n');log.flush()
  except SerialException:log.write('USB disconnected; no requests retransmitted\n');log.flush()
PY
STEP=completed
echo '[INFO] Firmware write completed; boot/Face/SD/camera/audio acceptance remains manual and unverified.'
echo '[INFO] No photo or conversation request was sent. Confirm boot ID and debug/status before acceptance.'
