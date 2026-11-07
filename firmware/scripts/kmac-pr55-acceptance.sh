#!/usr/bin/env bash
# StackChan #33: pinned PR -> isolated tests/build -> 16MiB backup -> flash -> physical voice/photo E2E.
# Usage: STACKCHAN_EXPECTED_SHA=<reviewed-full-sha> bash kmac-pr55-acceptance.sh all
# Other modes: check | build | flash | test [voice-e2e-case] | restore /abs/backup.bin
clear
umask 077
STEP=PREFLIGHT
MODE="$1"
if [[ -z "$MODE" ]]; then MODE=all; fi
REPO="$STACKCHAN_REPO"
if [[ -z "$REPO" ]]; then REPO=/mnt/data/Development/stackchan/stack-chan; fi
WORKTREE="$STACKCHAN_ACCEPTANCE_WORKTREE"
if [[ -z "$WORKTREE" ]]; then WORKTREE=/mnt/data/Development/stackchan/stack-chan-pr55-acceptance; fi
FORK=https://github.com/messpy/stack-chan.git
BASE=f710e5154b259e13fae3a494c044a67d028122ef
PR=55
SERVICE="$STACKCHAN_HUB_SERVICE"
TMP=
log(){ printf '[%s] STEP=%s %s\n' "$1" "$STEP" "$2"; }
die(){
  log FATAL "$1" >&2
  if [[ -t 2 && -r /dev/tty ]]; then
    printf '[ACTION] Enterで終了: ' >/dev/tty
    IFS= read -r _ </dev/tty || :
  fi
  exit 1
}
cleanup(){
  if [[ -n "$TMP" && -f "$TMP" ]]; then rm -f -- "$TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
case "$MODE" in
  check|build|flash|all|test|restore) ;;
  *) die '使い方: check|build|flash|all|test [case]|restore /absolute/backup.bin' ;;
esac
command -v git >/dev/null 2>&1 || die 'gitがありません'
command -v python3 >/dev/null 2>&1 || die 'python3がありません'
[[ -d "$REPO/firmware" && -e "$REPO/.git" ]] || die "StackChanリポジトリがありません: $REPO"
[[ "$WORKTREE" != "$REPO" && "$WORKTREE" != /tmp/* ]] || die '専用worktreeのパスが危険です'
cd "$REPO" || die 'リポジトリへ移動できません'
log CHECK "host=$(hostname) shell=bash repo=$REPO"
log INFO '既存作業ツリーとGitHubの統合先ブランチは変更しません'

if [[ "$MODE" == restore ]]; then
  STEP=RESTORE
  [[ -f "$WORKTREE/firmware/scripts/kmac-pr39.sh" ]] || die '復旧用スクリプトが専用worktreeにありません'
  log WARN '16MiBフラッシュの復元はNVSを含みます。SDカードは対象外です'
  bash "$WORKTREE/firmware/scripts/kmac-pr39.sh" restore "$2"
  exit $?
fi

STEP=FETCH
command -v git >/dev/null 2>&1 || die 'gitがありません'
log ACTION "forkのPR #$PRを取得（checkoutは変更しない）"
git fetch --no-tags --quiet "$FORK" "refs/pull/$PR/head" || die 'PRを取得できません。ネット接続を確認してください'
COMMIT="$(git rev-parse --verify 'FETCH_HEAD^{commit}' 2>/dev/null)" || die '取得したコミットを検証できません'
[[ -n "$STACKCHAN_EXPECTED_SHA" ]] || die 'STACKCHAN_EXPECTED_SHAにレビュー済みの40桁SHAを指定してください'
[[ "$STACKCHAN_EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || die '期待SHAは40桁の16進数で指定してください'
[[ "$COMMIT" == "$STACKCHAN_EXPECTED_SHA" ]] || die "PRがレビュー時から変化しています（取得=$COMMIT）。再レビューが必要です"
git merge-base --is-ancestor "$BASE" "$COMMIT" || die 'PRが実機の現行基準commitを含んでいません'
git cat-file -e "$COMMIT:firmware/scripts/kmac-pr39.sh" || die 'PR内の既存安全更新スクリプトがありません'
log CHECK "PR #$PR exact commit=$COMMIT"

STEP=CI
if [[ "$MODE" == all || "$MODE" == flash ]]; then
  command -v gh >/dev/null 2>&1 || die 'CI検証にghコマンドが必要です。build/checkモードは実行できます'
  log CHECK '同じcommitのGitHub Actionsを検証'
  RUNS="$(gh api "repos/messpy/stack-chan/commits/$COMMIT/check-runs?per_page=100" \
    --jq '.check_runs[] | select(.name=="camera-voice-regression" or .name=="cores3-clean-build") | [.name,.status,(.conclusion//"pending")] | @tsv' 2>/dev/null)" ||
    die 'CI情報を取得できません。gh auth statusを確認してください'
  printf '%s\n' "$RUNS" | grep -Fxq "$(printf 'camera-voice-regression\tcompleted\tsuccess')" ||
    die 'camera-voice-regressionがPASSではありません。書込み中止'
  printf '%s\n' "$RUNS" | grep -Fxq "$(printf 'cores3-clean-build\tcompleted\tsuccess')" ||
    die 'cores3-clean-buildがPASSではありません。書込み中止'
  log CHECK '音声・撮影回帰テストとCoreS3ビルドのCIが両方PASS'
else
  log INFO 'check/build/testではCIゲートを省略（ローカル試験は既存スクリプトが実施）'
fi

STEP=SETUP
mkdir -p "$HOME/.cache" || die '一時ファイルディレクトリを作成できません'
TMP="$(mktemp "$HOME/.cache/stackchan-pr55.XXXXXXXX.sh")" || die '一時ファイルを作れません'
git show "$COMMIT:firmware/scripts/kmac-pr39.sh" >"$TMP" || die '安全更新スクリプトを取り出せません'
chmod 700 "$TMP" || die '一時ファイルの権限を変更できません'
export STACKCHAN_SOURCE_REF="$COMMIT"
export STACKCHAN_REPO="$REPO"
export STACKCHAN_ACCEPTANCE_WORKTREE="$WORKTREE"
if [[ -z "$STACKCHAN_DEVICE_IP" ]]; then export STACKCHAN_DEVICE_IP=192.168.2.102; fi
if [[ -z "$SERVICE" ]]; then SERVICE=stackchan-hub.service; fi
export STACKCHAN_HUB_SERVICE="$SERVICE"
log CHECK "専用worktree=$WORKTREE"
log INFO "診断先IP=$STACKCHAN_DEVICE_IP（違う場合は環境変数で指定）"
log INFO 'ビルドは共有Moddable SDKにパッチを適用する場合があります。既存スクリプトが確認します'
log INFO '書込み前に現行16MiBをバックアップし、yes/no確認後にのみflashします'
log INFO "ロールバックは本スクリプトの restore /path/to/core-s3-....bin を使用"

STEP=RUN
log ACTION "検証手順=$MODE（kmac-pr39.shを固定commitから実行）"
if [[ "$MODE" == test ]]; then
  bash "$TMP" test "$2"
else
  bash "$TMP" "$MODE"
fi
RC=$?
if ((RC != 0)); then
  die "既存更新フローがexit=$RCで停止。書込み済みの場合は専用worktreeの更新ログとバックアップを確認"
fi

if [[ "$MODE" == all ]]; then
  STEP=PHYSICAL
  log WARN 'LANの撮影状態と音声録音のみではJPEGの中身・画面・実際の二重発話は確認できません'
  if [[ ! -r /dev/tty ]]; then die '実機最終確認には対話端末が必要です'; fi
  printf '[ACTION] 本体を確認：新しい写真の内容が正しく、公式の顔が維持され、会話が再開し、二重謝罪や無指示撮影がない場合だけyes (yes/no): ' >/dev/tty
  IFS= read -r ANSWER </dev/tty || die '確認入力失敗'
  [[ "$ANSWER" == yes ]] || die '実機受入はFAIL/UNVERIFIED。GitHub PRのマージは保留'
  log CHECK '実機で画像内容・顔・会話復帰の確認をユーザーが承認しました'
fi

STEP=DONE
log CHECK "完了: commit=$COMMIT mode=$MODE"
log INFO "専用worktree=$WORKTREE"
log INFO 'GitHub PR #55はDraftのまま。CI・実機検証結果の確認後に別途マージしてください'
