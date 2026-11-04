#!/usr/bin/env bash
# kmac PR39: check | build | flash | all (ordinary chat + photo E2E) | test [case] | restore
# Use through: git show FETCH_HEAD:firmware/scripts/kmac-pr39.sh | bash -s -- all
if [[ -t 1 ]]; then clear; fi
umask 077
STEP=PREFLIGHT
MODE="${1:-check}"
REF="${STACKCHAN_SOURCE_REF:-FETCH_HEAD}"
REPO="${STACKCHAN_REPO:-}"
SERVICE="${STACKCHAN_HUB_SERVICE:-stackchan-hub.service}"
HUB_STOPPED=no
PORT=""
BACKUP=""
log(){ printf '[%s] STEP=%s %s\n' "$1" "$STEP" "$2"; }
die(){
  log FATAL "$1" >&2
  if [[ -t 2 && -r /dev/tty ]]; then read -r -p 'Enterで終了: ' _ </dev/tty || :; fi
  exit 1
}
finish(){
  local rc=$?
  trap - EXIT
  if [[ "$HUB_STOPPED" == yes ]]; then
    log ACTION "Hubサービスを再開"
    systemctl --user start "$SERVICE" || log WARN "Hub復帰に失敗: $SERVICE"
  fi
  if (( rc!=0 )); then log ERROR "exit=$rc。既存ファームウェアのバックアップと更新ログを確認してください"; fi
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
confirm(){
  [[ -r /dev/tty ]] || die "書き込み/復元には対話端末が必要です"
  local yesno=""
  printf '[ACTION] STEP=%s %s (yes/no): ' "$STEP" "$1" >/dev/tty
  IFS= read -r yesno </dev/tty || die "確認入力失敗"
  [[ "$yesno" == yes ]] || die "ユーザーが中止しました"
}
case "$MODE" in check|build|flash|all|test|restore) ;; *) die "Usage: check|build|flash|all|test [case]|restore /absolute/path/backup.bin";; esac
command -v git >/dev/null 2>&1 || die "gitなし"
command -v python3 >/dev/null 2>&1 || die "python3なし"
if [[ -z "$REPO" ]]; then REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Gitリポジトリ内で実行してください"; fi
[[ -e "$REPO/.git" && -d "$REPO/firmware" ]] || die "StackChan作業ツリーを特定できません"
if [[ -d /mnt/data/Development/node22/current/bin ]]; then export PATH="/mnt/data/Development/node22/current/bin:$PATH"; fi
if [[ "$MODE" == restore ]]; then
  # Recovery must not depend on FETCH_HEAD, a full SDK or a private manifest.
  COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" || die "GitリポジトリのHEADを読めません"
else
  COMMIT="$(git -C "$REPO" rev-parse --verify "$REF^{commit}" 2>/dev/null)" || die "PR #39をfetchしてください"
  git -C "$REPO" cat-file -e "$COMMIT:firmware/scripts/kmac-pr39.sh" 2>/dev/null || die "PR #39のスクリプトを含まないコミットです"
fi
log CHECK "対象commit=$COMMIT; 既存checkoutは変更しません"
git -C "$REPO" status --short --branch | head -n 8
PRIVATE_SOURCE="$REPO/firmware/host/app/manifest_archive_private.json"
WORKTREE="${STACKCHAN_ACCEPTANCE_WORKTREE:-$(dirname "$REPO")/stack-chan-pr39-acceptance}"
if [[ "$MODE" == check ]]; then
  STEP=CHECK
  command -v node >/dev/null 2>&1 && node --version || log WARN "Nodeなし"
  python3 --version
  [[ -f "$PRIVATE_SOURCE" && ! -L "$PRIVATE_SOURCE" ]] && log CHECK "private manifestあり（トークンは非表示）" || log WARN "private manifestなし"
  for f in "$HOME/.local/share/xs-dev-export.sh" "$HOME/.local/share/esp32/esp-idf/export.sh"; do
    [[ -r "$f" ]] && log INFO "envあり: $f" || log WARN "envなし: $f"
  done
  shopt -s nullglob; ports=(/dev/ttyACM* /dev/ttyUSB*); shopt -u nullglob
  if ((${#ports[@]})); then printf '[INFO] USB=%s\n' "${ports[@]}"; else log WARN "USB未接続"; fi
  log CHECK "READ-ONLY完了"
  exit 0
fi
STEP=LOCK
command -v flock >/dev/null 2>&1 || die "flock(util-linux)がありません"
mkdir -p "$HOME/.cache" || die "ロックディレクトリ作成失敗"
exec 8>"$HOME/.cache/stackchan-pr39.lock" || die "ロックを開けません"
flock -n 8 || die "別のStackChan更新または復旧が実行中です"
log CHECK "更新・復旧の排他ロック取得"
if [[ "$MODE" != restore ]]; then
STEP=WORKTREE
[[ "$WORKTREE" != "$REPO" && "$WORKTREE" != /tmp/* ]] || die "専用worktreeパスが危険です"
free="$(df -Pk "$(dirname "$REPO")" | awk 'NR==2 {print $4}')"
[[ "$free" =~ ^[0-9]+$ && "$free" -ge 3145728 ]] || die "worktree作成用に3GiB以上の空き容量が必要"
if [[ -e "$WORKTREE" ]]; then
  real="$(git -C "$WORKTREE" rev-parse --show-toplevel 2>/dev/null)" || die "既存パスはgit worktreeではありません"
  [[ "$real" == "$WORKTREE" ]] || die "専用worktreeが別repoを指しています"
  dirty="$(git -C "$WORKTREE" status --porcelain --untracked-files=normal)" || die "専用worktreeの状態確認失敗"
  [[ -z "$dirty" ]] || die "専用worktreeに未コミット差分があります。自動上書きしません"
  current="$(git -C "$WORKTREE" rev-parse HEAD)" || die "HEAD取得失敗"
  if [[ "$current" != "$COMMIT" ]]; then git -C "$WORKTREE" checkout --detach "$COMMIT" || die "専用worktree切替失敗"; fi
else
  git -C "$REPO" worktree add --detach "$WORKTREE" "$COMMIT" || die "専用worktree作成失敗"
fi
FW="$WORKTREE/firmware"
PRIVATE_TARGET="$FW/host/app/manifest_archive_private.json"
[[ -f "$PRIVATE_SOURCE" && ! -L "$PRIVATE_SOURCE" ]] || die "既存repo側にprivate manifestがありません。npm run init:archiveで初期化してください"
if [[ -e "$PRIVATE_TARGET" || -L "$PRIVATE_TARGET" ]]; then
  [[ ! -L "$PRIVATE_TARGET" ]] || die "private manifestがsymlinkです"
  cmp -s "$PRIVATE_SOURCE" "$PRIVATE_TARGET" || die "2つのprivate manifestが異なるため、中止"
else
  install -m 600 "$PRIVATE_SOURCE" "$PRIVATE_TARGET" || die "private manifestの引継ぎ失敗"
fi
log CHECK "専用worktree=$WORKTREE; 既存認証設定を保持"
fi
FW="${FW:-$REPO/firmware}"
if [[ "$MODE" != restore ]]; then
  command -v node >/dev/null 2>&1 || die "Nodeなし"
  command -v npm >/dev/null 2>&1 || die "npmなし"
  major="$(node -p 'Number(process.versions.node.split(".")[0])')" || die "Node取得失敗"
  [[ "$major" =~ ^[0-9]+$ && "$major" -ge 22 ]] || die "Node.js 22以上が必要"
fi
dependencies(){
  STEP=NODE_MODULES
  [[ -f "$FW/package-lock.json" ]] || die "package-lock.jsonがありません"
  local expected stamp
  expected="$(sha256sum "$FW/package-lock.json" | awk '{print $1}')" || die "依存lockのハッシュ取得失敗"
  stamp="$FW/node_modules/.stackchan-pr39-package-lock.sha256"
  if [[ -f "$stamp" && -x "$FW/node_modules/.bin/tsc" && "$(cat "$stamp")" == "$expected" ]]; then
    log CHECK "専用worktreeのNode依存は既に一致しています"
    return 0
  fi
  log ACTION "専用worktreeにnpm ciを実行（既存repoのnode_modulesは変更しません）"
  log INFO "ローカルnpmキャッシュを優先し、未キャッシュの依存はネットから取得します"
  (cd "$FW" && npm ci --prefer-offline --no-audit --no-fund) ||
    die "依存関係のインストールに失敗。npmキャッシュ/ネット接続と容量を確認"
  [[ -x "$FW/node_modules/.bin/tsc" ]] || die "npm ci後にTypeScriptがありません"
  printf '%s\n' "$expected" >"$stamp" || die "依存stamp保存失敗"
}
tests(){
  STEP=UNIT
  log ACTION "Node/Python回帰試験（書込なし）"
  (cd "$FW" && node --experimental-vm-modules --test \
    scripts/lib/archive-ai-boot-restore.test.mjs scripts/lib/archive-ai-mode-persistence.test.mjs \
    scripts/lib/archive-vault-mode-recovery.test.mjs scripts/lib/archive-vault-slot-read.test.mjs \
    scripts/lib/archive-head-motion.test.mjs scripts/lib/archive-head-command-dedupe.test.mjs scripts/lib/archive-issues-33-36.test.mjs \
    scripts/lib/archive-voice-volume.test.mjs scripts/lib/archive-build-preflight.test.mjs) || die "NodeテストFAIL"
  (cd "$FW" && python3 -m unittest discover -s scripts -p 'test_voice_e2e.py' -v) || die "PythonテストFAIL"
  (cd "$FW" && python3 -m unittest discover -s scripts -p 'test_archive_usb_audit.py' -v) || die "USB/photo診断テストFAIL"
  (cd "$FW" && python3 -m unittest discover -s scripts -p 'test_archive_photo_lan.py' -v) || die "LAN/photo診断テストFAIL"
  (cd "$FW" && python3 -m unittest discover -s scripts -p 'test_voicevox_pc_play.py' -v) || die "PC音声再生テストFAIL"
}
build(){
  STEP=BUILD
  [[ -r "$HOME/.local/share/xs-dev-export.sh" && -r "$HOME/.local/share/esp32/esp-idf/export.sh" ]] || die "Moddable/IDF envがありません"
  log WARN "既存updaterは共有Moddable SDKのpatch-*.pyを適用します。別worktreeでもSDK側には変更が発生し得ます"
  confirm "共有SDKのパッチ適用とCoreS3ビルドを実行しますか？"
  log ACTION "既存のビルド専用フローを実行"
  (cd "$FW" && bash scripts/update-archive.sh --build-only) || die "ビルド失敗。dist/update-logs/latest.jsonを確認"
  IMAGE="$FW/dist/bin/esp32/m5stack_cores3/release/stack-chan-host/xs_esp32.bin"
  [[ -f "$IMAGE" ]] || die "生成されたCoreS3バイナリがありません"
  bytes="$(stat -c %s "$IMAGE")"
  [[ "$bytes" -gt 100000 ]] || die "ビルド成果物サイズが異常"
  log CHECK "ビルドOK: $bytes bytes"
}
device(){
  STEP=USB
  shopt -s nullglob; local ports=(/dev/ttyACM* /dev/ttyUSB*); shopt -u nullglob
  if [[ -n "${STACKCHAN_PORT:-}" ]]; then
    PORT="$STACKCHAN_PORT"
    [[ "$PORT" == /dev/ttyACM* || "$PORT" == /dev/ttyUSB* ]] || die "STACKCHAN_PORTは/dev/ttyACM*または/dev/ttyUSB*のみ"
  else
    ((${#ports[@]}==1)) || die "USBが${#ports[@]}個。1台にするかSTACKCHAN_PORTで指定"
    PORT="${ports[0]}"
  fi
  [[ -c "$PORT" && -r "$PORT" && -w "$PORT" ]] || die "USBシリアルの権限/接続を確認: $PORT"
  if command -v esptool >/dev/null 2>&1; then ESP="$(command -v esptool)"
  elif command -v esptool.py >/dev/null 2>&1; then ESP="$(command -v esptool.py)"
  elif [[ -x "$HOME/.local/bin/esptool" ]]; then ESP="$HOME/.local/bin/esptool"
  else die "esptoolがありません"; fi
  READ=read-flash; WRITE=write-flash
  if ! "$ESP" --help 2>&1 | grep -q read-flash; then READ=read_flash; WRITE=write_flash; fi
  log CHECK "USB=$PORT; esptool=$ESP"
}
stop_hub(){
  if command -v systemctl >/dev/null && systemctl --user is-active --quiet "$SERVICE"; then
    systemctl --user stop "$SERVICE" || die "USBサービスを停止できません"
    HUB_STOPPED=yes
  fi
  if command -v fuser >/dev/null; then
    busy="$(fuser "$PORT" 2>/dev/null)" || busy=""
    [[ -z "$busy" ]] || die "USB使用中(PID=$busy)。他のシリアルモニタを閉じてください"
  fi
}
backup(){
  STEP=BACKUP
  local dir="${STACKCHAN_BACKUP_DIR:-$HOME/stackchan-backups}"
  [[ "$dir" == /* ]] || die "バックアップ先は絶対パスで指定"
  mkdir -p "$dir" || die "バックアップ先の作成失敗"
  local room="$(df -Pk "$dir" | awk 'NR==2 {print $4}')"
  [[ "$room" =~ ^[0-9]+$ && "$room" -ge 40960 ]] || die "バックアップ先に40MiB以上の空きが必要"
  BACKUP="$dir/core-s3-$(date +%Y%m%d-%H%M%S)-${COMMIT:0:8}.bin"
  log ACTION "現行16MiBフラッシュを読取専用で保存"
  "$ESP" --chip esp32s3 --port "$PORT" --baud 460800 "$READ" 0 0x1000000 "$BACKUP" >"$BACKUP.read.log" 2>&1 ||
    die "バックアップ失敗。ログ=$BACKUP.read.log; 書込中止"
  [[ "$(stat -c %s "$BACKUP")" == 16777216 ]] || die "バックアップが16MiBでないため書込中止"
  (cd "$dir" && sha256sum "$(basename "$BACKUP")" >"$(basename "$BACKUP").sha256") || die "SHA256作成失敗"
  log CHECK "16MiB+SHA256バックアップOK: $BACKUP"
  log WARN "SDカード内のデータはこのバックアップに含まれません"
}
flash(){
  STEP=FLASH
  [[ -f "$FW/dist/bin/esp32/m5stack_cores3/release/stack-chan-host/xs_esp32.bin" ]] || die "ビルド成果物がありません"
  device; stop_hub; backup
  log WARN "#32首振りコードはPR #31を統合済みですが、実機確認は必要"
  confirm "$PORT にcommit ${COMMIT:0:12}を書き込みますか？"
  STEP=DEPLOY
  (cd "$FW" && export STACKCHAN_PORT="$PORT" UPLOAD_PORT="$PORT" && bash scripts/update-archive.sh --flash-only) ||
    die "書き込み失敗。復旧用バックアップ=$BACKUP"
  printf '%s\n' "$COMMIT" >"$FW/dist/update-logs/last-flashed-commit.txt" || die "書込記録の保存失敗"
  log CHECK "書き込みコマンドOK（実機起動確認は別途）"
  log INFO "復旧用バックアップ=$BACKUP"
  if [[ "$HUB_STOPPED" == yes ]]; then
    systemctl --user start "$SERVICE" || die "USB管理サービス復帰失敗"
    HUB_STOPPED=no
  fi
}
restore(){
  STEP=RESTORE
  local path="${2:-}"
  [[ "$path" == /* && -f "$path" ]] || die "復元する.binの絶対パスを指定"
  [[ "$(basename "$path")" == core-s3-*.bin ]] || die "本スクリプトのバックアップのみを許可"
  [[ "$(stat -c %s "$path")" == 16777216 && -f "$path.sha256" ]] || die "バックアップが不完全"
  (cd "$(dirname "$path")" && sha256sum -c --status "$(basename "$path").sha256") || die "バックアップ検証失敗"
  device; stop_hub
  log WARN "復元するとNVS等フラッシュ全体がバックアップ時点に戻ります（SDは対象外）"
  confirm "$PORT に $path の16MiB全体を復元しますか？"
  "$ESP" --chip esp32s3 --port "$PORT" --baud 460800 "$WRITE" 0 "$path" >"$path.restore.log" 2>&1 ||
    die "復元失敗。ログ=$path.restore.log"
  log CHECK "復元コマンドOK。本体の起動確認が必要"
}
acoustic(){
  STEP=VOICE_E2E
  local case="${2:-ordinary_chat}"
  local speak="${STACKCHAN_SPEAK_SCRIPT:-/home/kmac/work/camera-voicevox/speak.py}"
  [[ -f "$speak" ]] || die "VOICEVOX speak.pyがありません: $speak"
  command -v arecord >/dev/null 2>&1 || die "arecord（alsa-utils）がありません"
  local output="${STACKCHAN_E2E_OUTPUT:-$HOME/stackchan-e2e}"
  mkdir -p "$output" || die "結果ディレクトリ作成失敗"
  local extra=()
  [[ -z "${STACKCHAN_DEVICE_LOG:-}" ]] || extra+=(--device-log "$STACKCHAN_DEVICE_LOG")
  [[ -z "${STACKCHAN_STT_COMMAND:-}" ]] || extra+=(--stt-command "$STACKCHAN_STT_COMMAND")
  log WARN "CoreS3の再起動・Wi-Fi接続完了後に実施。モードはケース毎に指定された条件が必要です"
  confirm "本体起動・必要なAIモード・PCスピーカー/マイクの準備を確認しましたか？"
  local player="${STACKCHAN_PC_PLAYER:-auto}"
  local play_device="${STACKCHAN_PLAY_DEVICE:-}"
  local player_args=""
  if [[ "$player" != auto ]]; then player_args=" --player $player"; fi
  if [[ -n "$play_device" ]]; then
    [[ "$player" == aplay ]] || die "STACKCHAN_PLAY_DEVICEの指定にはSTACKCHAN_PC_PLAYER=aplayが必要"
    [[ "$play_device" =~ ^[A-Za-z0-9_.,:-]+$ ]] || die "STACKCHAN_PLAY_DEVICEに不正な文字が含まれます"
    player_args="$player_args --alsa-device $play_device"
  fi
  local evidence_commit="$COMMIT"
  local flash_record="$FW/dist/update-logs/last-flashed-commit.txt"
  if [[ -r "$flash_record" ]]; then
    evidence_commit="$(head -n 1 "$flash_record")"
    if [[ "$evidence_commit" != "$COMMIT" ]]; then
      log WARN "テスト用スクリプトcommit=${COMMIT:0:12}、実機へ最後に書いたcommit=${evidence_commit:0:12}。混同しません"
    fi
  fi
  python3 "$FW/scripts/voice-e2e.py" capture --case "$case" \
    --speak-command "python3 $FW/scripts/voicevox-pc-play.py --speak-script $speak$player_args {text}" \
    --record-command "arecord -q -D ${STACKCHAN_RECORD_DEVICE:-default} -f S16_LE -r 16000 -c 1 -d 20 -t wav {wav}" \
    --timeout 90 --provider "${STACKCHAN_PROVIDER:-xiaozhi}" --firmware-sha "$evidence_commit" \
    --output-dir "$output" "${extra[@]}" || die "音響E2E失敗。録音デバイス/VOICEVOXを確認"
  log CHECK "PCの再生プロセス完了。聴覚上の確認を行います"
  confirm "今、PCから読み上げが実際に聞こえましたか？"
  log WARN "PC音響試験の記録完了。StackChan側の音声認識・応答はreview.jsonで別途検証=UNVERIFIED"
}
photo_probe(){
  STEP=PHOTO_STATUS
  local destination="$1" rc=2
  if [[ -n "$PHOTO_IP" ]]; then
    log ACTION "指定LAN IPで読み取り専用の写真状態確認"
    python3 "$FW/scripts/archive-photo-lan.py" --ip "$PHOTO_IP" \
      --config "$PRIVATE_TARGET" --output "$destination"
    return $?
  fi
  stop_hub
  log ACTION "USB /photo/status を読み取り専用で取得（応答がなければLANへ切替）"
  python3 "$FW/scripts/archive-usb-audit.py" --photo-only --config "$PRIVATE_TARGET" \
    --port "$PORT" --seconds 8 --json-out "$destination" --output "$destination.usb.log"
  rc=$?
  if [[ "$HUB_STOPPED" == yes ]]; then
    systemctl --user start "$SERVICE" || die "USB管理サービス復帰失敗"
    HUB_STOPPED=no
  fi
  if [[ "$rc" == 0 ]]; then return 0; fi
  log WARN "USB診断に応答なし。撮影成功/失敗は未判定。LAN診断を試します"
  # USB creates a filtered file even on timeout. Preserve it as unverified, never reuse.
  if [[ -e "$destination" ]]; then
    mv -- "$destination" "$destination.usb-unverified" || die "未確認のUSBログの退避失敗"
  fi
  if [[ -z "$PHOTO_IP" && "$PHOTO_IP_ASKED" == no && -r /dev/tty ]]; then
    PHOTO_IP_ASKED=yes
    printf '[ACTION] STEP=PHOTO_STATUS 本体「スマホで操作」に表示されるLAN IP（空Enterでスキップ）: ' >/dev/tty
    IFS= read -r PHOTO_IP </dev/tty || PHOTO_IP=""
  fi
  if [[ -n "$PHOTO_IP" ]]; then
    log ACTION "LANの読み取り専用 /status を試行"
    python3 "$FW/scripts/archive-photo-lan.py" --ip "$PHOTO_IP" \
      --config "$PRIVATE_TARGET" --output "$destination"
    return $?
  fi
  log WARN "本体のLAN IPがないためphoto/statusはUNVERIFIED。撮影音声試験は継続します"
  return 2
}
photo_e2e(){
  STEP=PHOTO_E2E
  device
  local PHOTO_IP="${STACKCHAN_DEVICE_IP:-}" PHOTO_IP_ASKED=no
  local root="${STACKCHAN_E2E_OUTPUT:-$HOME/stackchan-e2e}"
  local dir="$root/photo-status-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -p "$dir" || die "診断結果ディレクトリ作成失敗"
  chmod 700 "$dir" || die "診断結果の権限設定失敗"
  local before_ok=no after_ok=no
  log CHECK "Issue #33: 撮影前の状態を取得"
  if photo_probe "$dir/before.json"; then before_ok=yes
  else log WARN "撮影前の状態取得失敗。録音・音声テストは実行します"; fi
  log ACTION "音声で「写真撮って」を実行し、PCマイクで収録"
  acoustic test photo_explicit
  log CHECK "Issue #33: 撮影後の状態を取得"
  if photo_probe "$dir/after.json"; then after_ok=yes
  else log WARN "撮影後の状態取得失敗。音声テストの記録は保存済み"; fi
  STEP=PHOTO_VERDICT
  if [[ "$before_ok" == yes && "$after_ok" == yes ]]; then
    python3 "$FW/scripts/archive-usb-audit.py" --compare-photo "$dir/before.json" "$dir/after.json" ||
      die "Issue #33 撮影ステータスがFAIL/UNVERIFIED。診断結果=$dir"
    log CHECK "Issue #33: 新しい写真のSD保存を本体が報告。画像内容/AI応答の品質は手動検証"
  else
    log WARN "Issue #33: USB/LANから撮影前後を確認できずUNVERIFIED。診断結果=$dir"
    exit 2
  fi
  log INFO "診断結果=$dir"
}
case "$MODE" in
  build) dependencies; tests; build ;;
  flash)
    device # Read-only USB/esptool preflight before a potentially long build.
    dependencies; tests; build; flash ;;
  all)
    device # Fail early if the expected device or esptool is missing.
    [[ -f "${STACKCHAN_SPEAK_SCRIPT:-/home/kmac/work/camera-voicevox/speak.py}" ]] || die "VOICEVOX speak.pyがありません。テスト不要ならflashを指定"
    command -v arecord >/dev/null 2>&1 || die "arecordがありません。テスト不要ならflashを指定"
    command -v paplay >/dev/null 2>&1 || command -v pw-play >/dev/null 2>&1 || command -v aplay >/dev/null 2>&1 || die "PC音声再生用のpaplay/pw-play/aplayがありません。書込前に停止"
    dependencies; tests; build; flash; acoustic test ordinary_chat; photo_e2e ;;
  test)
    dependencies; tests
    if [[ "${2:-}" == photo_explicit ]]; then photo_e2e
    else acoustic "$@"
    fi ;;
  restore) restore "$@" ;;
esac
STEP=DONE
log INFO "元の作業ツリー未変更。専用worktree=$WORKTREE"
log INFO "更新ログ=$FW/dist/update-logs/latest.json"
log WARN "書込成功だけでは実機検証PASSではありません"
