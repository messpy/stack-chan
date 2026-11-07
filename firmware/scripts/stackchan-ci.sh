#!/usr/bin/env bash
clear
umask 077
# Run from any directory: bash scripts/stackchan-ci.sh test|build|flash|diagnose|camera|voicevox|status [--yes]
STEP="PREFLIGHT"
MODE="$1"
AUTO_YES=0
if [ "$2" = "--yes" ]; then AUTO_YES=1; fi
FW=$(cd -- "$(dirname -- "$0")/.." && pwd -P) || exit 1
ROOT=$(dirname "$FW")
BASE="$(dirname "$ROOT")/stack-chan"
if [ -n "$STACKCHAN_BASE" ]; then BASE="$STACKCHAN_BASE"; fi
CONFIG="$FW/host/app/manifest_archive_private.json"
SOURCE_CONFIG="$BASE/firmware/host/app/manifest_archive_private.json"
BIN="$FW/dist/bin/esp32/m5stack_cores3/release/stack-chan-host/xs_esp32.bin"
STATUS="$FW/dist/update-logs/latest.json"
BUILD_REV="$FW/dist/update-logs/build-commit.txt"
BACKUPS="$HOME/stackchan-backups"
if [ -n "$STACKCHAN_BACKUP_DIR" ]; then BACKUPS="$STACKCHAN_BACKUP_DIR"; fi
SERVICE="stackchan-hub.service"
if [ -n "$STACKCHAN_HUB_SERVICE" ]; then SERVICE="$STACKCHAN_HUB_SERVICE"; fi
HUB_STOPPED=0
VOICEVOX_SCRIPT="/home/kmac/work/camera-voicevox/speak.py"
if [ -n "$STACKCHAN_VOICEVOX_SCRIPT" ]; then VOICEVOX_SCRIPT="$STACKCHAN_VOICEVOX_SCRIPT"; fi
fatal() {
  echo "[FATAL] STEP=$STEP $1" >&2
  if [ -t 0 ]; then read -r -p "Enterで終了: " _; fi
  exit 1
}
confirm() {
  if [ "$AUTO_YES" -eq 1 ]; then return 0; fi
  if [ ! -t 0 ]; then fatal "対話確認が必要です。承認済みなら --yes を指定してください"; fi
  read -r -p "[ACTION] $1 (yes/no): " ANSWER || fatal "確認入力なし"
  [ "$ANSWER" = "yes" ] || fatal "中止しました"
}
cleanup() {
  if [ "$HUB_STOPPED" -eq 1 ]; then
    echo "[ACTION] USB管理サービスを復旧"
    systemctl --user start "$SERVICE" || echo "[ERROR] サービス復旧に失敗" >&2
  fi
}
trap cleanup EXIT
run_voicevox() {
  STEP="VOICEVOX"
  echo "[CHECK] STEP=$STEP kmacのVOICEVOX音声テスト"
  if [ ! -f "$VOICEVOX_SCRIPT" ]; then
    echo "[WARN] VOICEVOXスクリプトがありません: $VOICEVOX_SCRIPT" >&2
    return 2
  fi
  command -v python3 >/dev/null 2>&1 || { echo "[ERROR] Python3がありません" >&2; return 3; }
  echo "[ACTION] VOICEVOXで日本語を読み上げます（kmac側の音声出力）"
  python3 "$VOICEVOX_SCRIPT" "スタックチャンの書き込みが完了しました。ボイスボックスの音声テストです。" || {
    echo "[ERROR] VOICEVOX読み上げに失敗しました" >&2
    return 1
  }
  echo "[CHECK] VOICEVOXコマンド正常終了。実際の音声は耳で確認してください"
}

case "$MODE" in
  help|-h|--help|'')
    echo "Usage: bash scripts/stackchan-ci.sh {test|build|flash|diagnose|camera|voicevox|status} [--yes]"
    echo "test=単体テスト build=テスト+ビルド flash=16MiBバックアップ+書き込み+VOICEVOX voicevox=kmac単体音声テスト diagnose=USB音声診断 camera=単体撮影検証 status=結果確認"
    exit 0
    ;;
  test|build|flash|diagnose|camera|voicevox|status) ;;
  *) fatal "不明なモード: $MODE";;
esac
[ -z "$3" ] || fatal "引数が多すぎます"
if [ -n "$2" ] && [ "$2" != "--yes" ]; then fatal "第2引数は --yes のみ対応"; fi
cd "$FW" || fatal "firmwareディレクトリがありません"
if [ "$MODE" = "voicevox" ]; then
  run_voicevox || fatal "VOICEVOXテスト失敗"
  exit 0
fi
if [ "$MODE" = "camera" ]; then
  STEP="CAMERA"
  confirm "写真を1枚撮影してSDへ保存しますか？（クラウド解析はしません）"
  python3 scripts/stackchan-camera-probe.py || fatal "撮影診断に失敗しました"
  exit 0
fi
if [ "$MODE" = "diagnose" ]; then
  STEP="DIAGNOSE"
  echo "[CHECK] STEP=$STEP USB音声・AI診断"
  command -v python3 >/dev/null 2>&1 || fatal "Python3がありません"
  python3 scripts/stackchan-voice-diagnostic.py || fatal "USB診断失敗"
  exit 0
fi
if [ "$MODE" = "status" ]; then
  STEP="STATUS"
  echo "[CHECK] 最新の実行結果"
  if [ -f "$STATUS" ]; then
    python3 -m json.tool "$STATUS" || fatal "状態JSONが不正"
  else
    echo "[WARN] 実行履歴なし"
  fi
  if [ -s "$BIN" ]; then
    ls -lh "$BIN"
    sha256sum "$BIN" || fatal "ハッシュ取得失敗"
  fi
  exit 0
fi

STEP="PREFLIGHT"
echo "[CHECK] Git/Node/USB診断環境"
command -v git >/dev/null 2>&1 || fatal "gitがありません"
command -v python3 >/dev/null 2>&1 || fatal "python3がありません"
[ -f host/app/manifest_archive.example.json ] || fatal "archiveソースが見つかりません"
HEAD=$(git -C "$ROOT" rev-parse HEAD) || fatal "Gitコミットを取得できません"
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] ||
  fatal "追跡ファイルに未コミット変更があります"
echo "[INFO] COMMIT=$HEAD"

if [ "$MODE" = "test" ] || [ "$MODE" = "build" ]; then
  STEP="TEST"
  echo "[ACTION] USB診断ログ単体テスト"
  NODE_BIN="/mnt/data/Development/node22/current/bin"
  if [ -n "$STACKCHAN_NODE_BIN" ]; then NODE_BIN="$STACKCHAN_NODE_BIN"; fi
  if [ -x "$NODE_BIN/node" ]; then export PATH="$NODE_BIN:$PATH"; fi
  command -v node >/dev/null 2>&1 || fatal "Node.jsがありません"
  NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])") || fatal "Nodeバージョン取得失敗"
  [ "$NODE_MAJOR" -ge 22 ] || fatal "Node.js 22以上が必要です"
  node --experimental-vm-modules --test scripts/lib/archive-conversation-log.test.mjs ||
    fatal "単体テスト失敗"
  if [ "$MODE" = "test" ]; then
    echo "[CHECK] テスト成功"
    exit 0
  fi
  STEP="CONFIG"
  echo "[CHECK] 認証設定と依存関係"
  git check-ignore -q host/app/manifest_archive_private.json ||
    fatal "認証設定がGitから除外されていません"
  if [ ! -s "$CONFIG" ]; then
    [ -s "$SOURCE_CONFIG" ] || fatal "既存の認証設定がありません。新規トークンは生成しません"
    install -m 600 "$SOURCE_CONFIG" "$CONFIG" || fatal "認証設定コピー失敗"
  fi
  python3 -m json.tool "$CONFIG" >/dev/null || fatal "認証設定JSONが不正"
  if [ ! -e node_modules ]; then
    if [ -d "$BASE/firmware/node_modules" ]; then
      ln -s "$BASE/firmware/node_modules" node_modules || fatal "依存関係リンク作成失敗"
    else
      fatal "node_modulesがありません。先にnpm ciを実行してください"
    fi
  fi
  STEP="BUILD"
  echo "[WARN] 共有Moddable SDKへ既存の互換性パッチが適用される可能性があります"
  confirm "CoreS3をビルドしますか？（本体書き込みなし）"
  echo "[ACTION] ビルド開始"
  bash scripts/update-archive.sh --build-only || fatal "ビルド失敗。dist/update-logsを確認"
  [ -s "$BIN" ] || fatal "ファームウェアが生成されていません"
  printf "%s\n" "$HEAD" > "$BUILD_REV" || fatal "ビルドコミット記録失敗"
  ls -lh "$BIN"
  sha256sum "$BIN" || fatal "チェックサム取得失敗"
  echo "[CHECK] ビルド成功。本体への書き込みなし"
  exit 0
fi

STEP="VERIFY"
echo "[CHECK] ビルド成果物とUSB接続"
[ -s "$CONFIG" ] || fatal "認証設定がありません"
[ -s "$BIN" ] || fatal "ビルド成果物がありません。先にbuildしてください"
[ -s "$BUILD_REV" ] || fatal "ビルドコミット記録がありません。先にbuildしてください"
[ "$(cat "$BUILD_REV")" = "$HEAD" ] || fatal "ビルド後にGitコミットが更新されています。先にbuildしてください"
[ -f "$STATUS" ] || fatal "ビルド履歴がありません"
python3 - "$STATUS" "$BIN" <<'PY' || fatal "ビルド証跡がありません。先にbuildしてください"
import datetime, json, pathlib, sys
try:
    result = json.loads(pathlib.Path(sys.argv[1]).read_text())
    started = datetime.datetime.fromisoformat(result['started_at']).timestamp()
    binary = pathlib.Path(sys.argv[2])
    assert result['state'] in ('built', 'succeeded')
    assert binary.stat().st_mtime >= started
    assert binary.stat().st_size > 1048576
except (AssertionError, KeyError, ValueError, OSError) as error:
    print('[ERROR] 不正なビルド履歴:', type(error).__name__)
    raise SystemExit(1)
PY
PORT="$STACKCHAN_PORT"
if [ -z "$PORT" ]; then
  shopt -s nullglob
  set -- /dev/ttyACM* /dev/ttyUSB*
  [ "$#" -eq 1 ] || fatal "USBシリアルが複数または0台です。STACKCHAN_PORTで指定"
  PORT="$1"
fi
[ -c "$PORT" ] && [ -r "$PORT" ] && [ -w "$PORT" ] ||
  fatal "USBポートが使用できません: $PORT"
if command -v esptool >/dev/null 2>&1; then
  ESPTOOL=$(command -v esptool)
elif [ -x "$HOME/.local/bin/esptool" ]; then
  ESPTOOL="$HOME/.local/bin/esptool"
else
  fatal "esptoolがありません"
fi
command -v sha256sum >/dev/null 2>&1 || fatal "sha256sumがありません"
confirm "$PORT の16MiBバックアップ後にファームウェアを書き込みますか？"

STEP="BACKUP"
echo "[ACTION] 現行16MiBフラッシュを読み取り専用でバックアップ"
mkdir -p "$BACKUPS" || fatal "バックアップ先作成失敗"
FREE_KB=$(df -Pk "$BACKUPS" | awk 'END{print $4}')
[ "$FREE_KB" -ge 32768 ] || fatal "空き容量が32MiB未満です"
if command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet "$SERVICE"; then
  systemctl --user stop "$SERVICE" || fatal "USB管理サービス停止失敗"
  HUB_STOPPED=1
fi
if command -v fuser >/dev/null 2>&1; then
  PORT_USERS=$(fuser "$PORT" 2>/dev/null)
  if [ -n "$PORT_USERS" ]; then
    echo "[WARN] USBシリアルポートが他のプロセスによって使用されています"
    fuser -v "$PORT" 2>&1
    echo "[INFO] 対象プロセスを確認してください: ps -fp PID"
    fatal "ポート占有を検出しました。バックアップ・書き込みは行いません"
  fi
else
  echo "[WARN] fuserがないためポート占有の事前検査は省略します"
fi
BACKUP="$BACKUPS/core-s3-$(date +%Y%m%d-%H%M%S)-$$.bin"
[ ! -e "$BACKUP" ] || fatal "バックアップ名が衝突しました"
"$ESPTOOL" --chip esp32s3 --port "$PORT" read_flash 0 0x1000000 "$BACKUP" ||
  fatal "16MiB読取失敗。書き込みは行いません"
SIZE=$(stat -c '%s' "$BACKUP") || fatal "バックアップ容量確認失敗"
[ "$SIZE" -eq 16777216 ] || fatal "バックアップ不完全。書き込みは行いません"
sha256sum "$BACKUP" > "$BACKUP.sha256" || fatal "SHA256保存失敗"
echo "[CHECK] 16MiBバックアップ成功: $BACKUP"
echo "[WARN] SDカードはバックアップ対象外です"

STEP="FLASH"
echo "[ACTION] USBを抜かないでください。ファームウェアを書き込みます"
export UPLOAD_PORT="$PORT"
bash scripts/update-archive.sh --flash-only ||
  fatal "書き込み失敗。バックアップは $BACKUP です"
echo "[CHECK] 書き込み処理成功。会話・カメラの実機検証は未完了"
if [ -f "$VOICEVOX_SCRIPT" ]; then
  if ! run_voicevox; then
    echo "[WARN] VOICEVOXテストは失敗しましたが、ファームウェア書き込みは成功済みです"
  fi
else
  echo "[WARN] VOICEVOXテストは未実行です。スクリプトがありません: $VOICEVOX_SCRIPT"
fi
