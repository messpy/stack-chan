#!/usr/bin/env bash
# Safe KoeAct-JP CoreS3 standalone build helper. Never flashes a device.
if [ -t 1 ] && [ -n "$TERM" ]; then clear; fi
STEP="arguments"
MODE="$1"
[ -n "$MODE" ] || MODE=check
MODEL_DIR="$HOME/work/koeact-jp"
[ -z "$KOEACT_MODEL_DIR" ] || MODEL_DIR="$KOEACT_MODEL_DIR"
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
fatal(){
  echo "[FATAL] STEP=$STEP $1" >&2
  if [ -t 0 ]; then read -r -p "Enterで終了: " unused; fi
  exit 1
}
need(){ command -v "$1" >/dev/null 2>&1 || fatal "$1 が見つかりません"; }
confirm(){
  if [ ! -t 0 ]; then fatal "変更操作は対話型のyes/no確認が必要です"; fi
  local answer
  read -r -p "[ACTION] $1 [yes/no]: " answer
  [ "$answer" = "yes" ] || fatal "キャンセルしました"
}
help(){
  echo "Usage: bash scripts/koeact-standalone-build.sh [check|fetch|verify|build]"
  echo "check=read-only, fetch=official Hugging Face download, verify=read-only SHA256, build=standalone ESP-IDF build"
  echo "Set KOEACT_MODEL_DIR=/absolute/path to select model directory."
  echo "This script NEVER flashes the device."
}
case "$MODE" in
  check|fetch|verify|build) ;;
  help|-h|--help) help; exit 0 ;;
  *) help; fatal "不明なモード: $MODE" ;;
esac
[ "$#" -le 1 ] || fatal "余分な引数です"
case "$MODEL_DIR" in /*) ;; *) fatal "モデルディレクトリは絶対パスで指定してください" ;; esac
[ "$MODEL_DIR" != "/" ] || fatal "ルートディレクトリは指定できません"
echo "[CHECK] STEP=environment MODE=$MODE"
echo "[INFO] Model directory: $MODEL_DIR"
for tool in node hf idf.py; do
  if command -v "$tool" >/dev/null 2>&1; then echo "[INFO] $tool=$(command -v "$tool")"
  else echo "[WARN] $tool は未検出"; fi
done
echo "[INFO] MODDABLE=$MODDABLE IDF_PATH=$IDF_PATH"
echo "[INFO] Flash write / erase / deploy is disabled"
if [ "$MODE" = "check" ]; then
  echo "[CHECK] STEP=files"
  for item in SHA256SUMS cores3/ralomi_e13_stream40.espdl cores3/a2_weights.bin cores3/firmware/e05/CMakeLists.txt; do
    if [ -f "$MODEL_DIR/$item" ]; then echo "[INFO] Found: $item"
    else echo "[WARN] Missing: $item"; fi
  done
  exit 0
fi
if [ "$MODE" = "fetch" ]; then
  STEP="fetch"
  need hf
  confirm "公式 ayousanz/KoeAct-JP のCoreS3ファイルを $MODEL_DIR に取得しますか？"
  mkdir -p -- "$MODEL_DIR" || fatal "ダウンロード先を作成できません"
  hf download ayousanz/KoeAct-JP SHA256SUMS --local-dir "$MODEL_DIR" || fatal "ハッシュ表の取得に失敗しました"
  hf download ayousanz/KoeAct-JP --include 'cores3/**' --local-dir "$MODEL_DIR" || fatal "CoreS3ファイルの取得に失敗しました"
  echo "[INFO] 取得完了。次は verify を実行してください"
  exit 0
fi
STEP="verify"
need node
[ -f "$MODEL_DIR/SHA256SUMS" ] || fatal "SHA256SUMS がありません。先にfetchしてください"
[ -f "$MODEL_DIR/cores3/firmware/e05/CMakeLists.txt" ] || fatal "公式のe05プロジェクトがありません"
node "$SCRIPT_DIR/koeact-preflight.mjs" --model-dir "$MODEL_DIR" || fatal "モデルのSHA256照合に失敗しました"
echo "[WARN] モデル検証成功はStackChan本体への統合成功を意味しません"
if [ "$MODE" = "verify" ]; then exit 0; fi
STEP="build"
need idf.py
idf.py --version || fatal "ESP-IDFの環境変数とPATHを確認してください"
confirm "公式KoeActのCoreS3単体デモをビルドしますか？（Flash書込なし）"
cd -- "$MODEL_DIR/cores3/firmware/e05" || fatal "e05ディレクトリへ移動できません"
echo "[ACTION] KoeAct-JP公式単体版をビルド"
idf.py "-DRALOMI_ESPDL=$MODEL_DIR/cores3/ralomi_e13_stream40.espdl" "-DA2_WEIGHTS=$MODEL_DIR/cores3/a2_weights.bin" build || fatal "ビルドに失敗しました"
echo "[CHECK] ビルド成功。実機へのFlash書込は行っていません"
echo "[WARN] この成果物をStackChanへ書き込むと既存のファームウェアが置き換わります"
